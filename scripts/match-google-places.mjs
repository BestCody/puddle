import { createAdminClient } from '../lib/supabase/admin.js'
import { scoreGooglePlaceEssentialsMatch, scoreGooglePlaceMatch } from '../lib/app/google-place-match.js'

const APPLY = process.argv.includes('--apply')
const locationArgument = process.argv.find((value) => value.startsWith('--location='))?.split('=')[1] || null
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.GOOGLE_PLACE_MATCH_LIMIT || 2_000)))
const MIN_SCORE = Math.max(0.75, Math.min(0.99, Number(process.env.GOOGLE_PLACE_MATCH_MIN_SCORE || 0.86)))
const API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(25, Math.min(5_000, Number(process.env.GOOGLE_PLACE_MATCH_DELAY_MS || 100)))
const MAX_DETAILS_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.GOOGLE_PLACE_MATCH_MAX_DETAILS_CANDIDATES || 5)))
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504])
const SKU = Object.freeze({
  TEXT_SEARCH_PRO: 'text_search_pro',
  PLACE_DETAILS_PRO: 'place_details_pro',
  PLACE_DETAILS_ESSENTIALS: 'place_details_essentials'
})
if (!API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before matching locations.')

const admin = createAdminClient()
const requests = {
  textSearchPro: 0,
  textSearchIdsOnly: 0,
  placeDetailsPro: 0,
  placeDetailsEssentials: 0
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function normalizedLocation(location) {
  return {
    ...location,
    addressPublic: location.addressPublic ?? location.address_public ?? null
  }
}

function googleSearchBody(location) {
  const body = {
    textQuery: [location.name, location.city, location.region, location.country].filter(Boolean).join(', '),
    languageCode: 'en',
    pageSize: 5,
    locationBias: {
      circle: {
        center: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        radius: 200
      }
    }
  }
  if (/^[A-Z]{2}$/.test(String(location.country_code || ''))) body.regionCode = location.country_code
  return body
}

function retryAfterMilliseconds(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1_000)
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

async function reserveSku(sku) {
  const result = await admin.rpc('reserve_google_places_free_sku_v1', { target_sku: sku })
  if (result.error) throw result.error
  return result.data || { allowed: false, sku, remaining: 0 }
}

async function releaseSku(sku) {
  const result = await admin.rpc('release_google_places_free_sku_v1', { target_sku: sku })
  if (result.error) console.warn(`Could not release ${sku} quota reservation: ${result.error.message}`)
}

function countSuccessfulRequest(sku) {
  if (sku === SKU.TEXT_SEARCH_PRO) requests.textSearchPro += 1
  else if (sku === SKU.PLACE_DETAILS_PRO) requests.placeDetailsPro += 1
  else if (sku === SKU.PLACE_DETAILS_ESSENTIALS) requests.placeDetailsEssentials += 1
  else requests.textSearchIdsOnly += 1
}

async function requestJson(url, options, { sku = null, label }) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let reservation = null
    if (sku) {
      reservation = await reserveSku(sku)
      if (!reservation?.allowed) return { exhausted: true, budget: reservation, payload: null }
    }

    let response
    try {
      response = await fetch(url, {
        ...options,
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      if (sku) await releaseSku(sku)
      lastError = error
      if (attempt === 2) throw error
      await sleep(500 * (2 ** attempt))
      continue
    }

    if (response.ok) {
      countSuccessfulRequest(sku)
      return { exhausted: false, budget: reservation, payload: await response.json() }
    }

    if (sku) await releaseSku(sku)
    const error = new Error(`${label} returned ${response.status}.`)
    error.status = response.status
    lastError = error
    if (!RETRYABLE_HTTP.has(response.status) || attempt === 2) throw error
    const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'))
    await sleep(Math.max(retryAfter, 750 * (2 ** attempt)))
  }
  throw lastError || new Error(`${label} failed.`)
}

async function searchGooglePro(location) {
  return requestJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
    },
    body: JSON.stringify(googleSearchBody(location))
  }, { sku: SKU.TEXT_SEARCH_PRO, label: 'Google Text Search Pro' })
}

async function searchGoogleIdsOnly(location) {
  return requestJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id'
    },
    body: JSON.stringify(googleSearchBody(location))
  }, { label: 'Google Text Search IDs Only' })
}

async function googlePlaceDetails(placeId, sku) {
  const fieldMask = sku === SKU.PLACE_DETAILS_PRO
    ? 'id,displayName,formattedAddress,location'
    : 'id,formattedAddress,location'
  const label = sku === SKU.PLACE_DETAILS_PRO ? 'Google Place Details Pro' : 'Google Place Details Essentials'
  return requestJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(String(placeId))}`, {
    headers: {
      Accept: 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': fieldMask
    }
  }, { sku, label })
}

function rankedRichMatches(location, places) {
  return (places || [])
    .map((place) => ({ place, match: scoreGooglePlaceMatch(location, place) }))
    .filter((entry) => entry.match)
    .sort((a, b) => b.match.score - a.match.score)
}

function uniquePlaceIds(payload) {
  return [...new Set((payload?.places || []).map((place) => String(place?.id || '').trim()).filter(Boolean))]
    .slice(0, MAX_DETAILS_CANDIDATES)
}

async function findVerifiedMatch(location) {
  const richSearch = await searchGooglePro(location)
  if (!richSearch.exhausted) {
    const best = rankedRichMatches(location, richSearch.payload?.places)[0]
    if (best && best.match.score >= MIN_SCORE) {
      return { status: 'matched', place: best.place, match: best.match, mode: 'text_search_pro' }
    }
    return { status: 'no_match', mode: 'text_search_pro' }
  }

  const idsSearch = await searchGoogleIdsOnly(location)
  const ids = uniquePlaceIds(idsSearch.payload)
  if (!ids.length) return { status: 'no_match', mode: 'ids_only' }

  let proExhaustedAt = ids.length
  for (let index = 0; index < ids.length; index += 1) {
    const detail = await googlePlaceDetails(ids[index], SKU.PLACE_DETAILS_PRO)
    if (detail.exhausted) {
      proExhaustedAt = index
      break
    }
    const match = scoreGooglePlaceMatch(location, detail.payload)
    if (match && match.score >= MIN_SCORE) {
      return { status: 'matched', place: detail.payload, match, mode: 'ids_only_place_details_pro' }
    }
  }
  if (proExhaustedAt === ids.length) return { status: 'no_match', mode: 'ids_only_place_details_pro' }

  // Rich Place Details quota is gone. Spend the larger Essentials allowance only
  // on the candidates that were not already rejected with richer evidence, and
  // accept a mapping only when exactly one candidate survives the strict address
  // and distance scorer after every remaining candidate has been checked.
  const remainingIds = ids.slice(proExhaustedAt)
  const essentialsMatches = []
  for (let index = 0; index < remainingIds.length; index += 1) {
    const detail = await googlePlaceDetails(remainingIds[index], SKU.PLACE_DETAILS_ESSENTIALS)
    if (detail.exhausted) {
      return { status: 'quota_deferred', mode: 'ids_only_place_details_essentials' }
    }
    const match = scoreGooglePlaceEssentialsMatch(location, detail.payload)
    if (match) essentialsMatches.push({ place: detail.payload, match })
  }

  if (essentialsMatches.length === 1) {
    return {
      status: 'matched',
      place: essentialsMatches[0].place,
      match: essentialsMatches[0].match,
      mode: 'ids_only_place_details_essentials'
    }
  }
  if (essentialsMatches.length > 1) {
    return { status: 'quota_deferred', mode: 'ids_only_place_details_essentials_ambiguous' }
  }
  return { status: 'no_match', mode: 'ids_only_place_details_essentials' }
}

function retryAfter(attemptCount, failed = false) {
  if (!failed) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const hours = Math.min(7 * 24, Math.max(1, 2 ** Math.min(8, Number(attemptCount || 0))))
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function nextMonthRetry() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5, 0)).toISOString()
}

async function saveAttempt(location, { status, attemptCount, retryAfterValue, error = null }) {
  if (!APPLY) return
  const result = await admin.from('google_place_match_attempts').upsert({
    location_id: location.id,
    status,
    attempt_count: attemptCount,
    last_attempt_at: new Date().toISOString(),
    retry_after: retryAfterValue,
    last_error: error ? String(error).slice(0, 900) : null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'location_id' })
  if (result.error) throw result.error
}

let locations
if (locationArgument) {
  const result = await admin
    .from('locations')
    .select('id,name,latitude,longitude,city,region,country,country_code,address_public')
    .eq('id', locationArgument)
    .maybeSingle()
  if (result.error) throw result.error
  locations = result.data ? [{ ...result.data, attempt_count: 0 }] : []
} else {
  const result = await admin.rpc('claim_google_place_candidates_v2', { batch_size: LIMIT })
  if (result.error) throw result.error
  locations = result.data || []
}

let matched = 0
let saved = 0
let noMatch = 0
let quotaDeferred = 0
let failed = 0
const modes = {}
for (const rawLocation of locations) {
  const location = normalizedLocation(rawLocation)
  const attemptCount = Number(location.attempt_count || 0) + 1
  try {
    const result = await findVerifiedMatch(location)
    modes[result.mode] = Number(modes[result.mode] || 0) + 1

    if (result.status === 'quota_deferred') {
      quotaDeferred += 1
      console.log(`Deferring Google verification until free SKU quotas reset: ${location.name}`)
      await saveAttempt(location, {
        status: 'quota_deferred',
        attemptCount: Number(location.attempt_count || 0),
        retryAfterValue: nextMonthRetry()
      })
      await sleep(REQUEST_DELAY_MS)
      continue
    }

    if (result.status !== 'matched') {
      noMatch += 1
      console.log(`No verified Google match: ${location.name}`)
      await saveAttempt(location, {
        status: 'no_match',
        attemptCount,
        retryAfterValue: retryAfter(attemptCount, false)
      })
      await sleep(REQUEST_DELAY_MS)
      continue
    }

    matched += 1
    const matchedName = result.match.matchedName || null
    console.log(`${APPLY ? 'Saving' : 'Would save'} ${location.name} → ${matchedName || result.place.id} (${result.match.score.toFixed(3)}, ${result.match.distanceM.toFixed(1)} m, ${result.mode}).`)
    if (APPLY) {
      const mapping = await admin.from('location_google_places').upsert({
        location_id: location.id,
        google_place_id: result.place.id,
        status: 'verified',
        match_score: Number(result.match.score.toFixed(4)),
        matched_name: matchedName,
        matched_at: new Date().toISOString()
      }, { onConflict: 'location_id' })
      if (mapping.error) throw mapping.error
      const cleared = await admin.from('google_place_match_attempts').delete().eq('location_id', location.id)
      if (cleared.error) throw cleared.error
      saved += 1
    }
  } catch (error) {
    failed += 1
    console.warn(`${location.name}: ${error.message}`)
    try {
      await saveAttempt(location, {
        status: 'failed',
        attemptCount,
        retryAfterValue: retryAfter(attemptCount, true),
        error: error.message || 'Google Places request failed.'
      })
    } catch (attemptError) {
      console.warn(`${location.name}: could not persist Google retry state: ${attemptError.message}`)
    }
  }
  await sleep(REQUEST_DELAY_MS)
}

const usage = await admin.rpc('google_places_free_sku_usage_v1')
if (usage.error) throw usage.error
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  inspected: locations.length,
  matched,
  saved,
  noMatch,
  quotaDeferred,
  failed,
  minimumScore: MIN_SCORE,
  maxDetailsCandidates: MAX_DETAILS_CANDIDATES,
  requests,
  modes,
  freeSkuUsage: usage.data || []
}, null, 2))
if (!APPLY) console.log('Dry run only. Google requests still consume their applicable SKU allowance; verified mappings are not saved without --apply.')
