import { createAdminClient } from '../lib/supabase/admin.js'
import {
  scoreGoogleAutocompletePrediction,
  scoreGoogleNearbyPlaceMatch,
  scoreGooglePlaceEssentialsMatch,
  scoreGooglePlaceMatch
} from '../lib/app/google-place-match.js'
import { googlePrimaryTypesForKind } from '../lib/app/google-place-discovery.js'

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
  PLACE_DETAILS_ESSENTIALS: 'place_details_essentials',
  AUTOCOMPLETE_REQUESTS: 'autocomplete_requests',
  NEARBY_SEARCH_PRO: 'nearby_search_pro'
})
const AUTOCOMPLETE_UNLOCK_SKUS = [
  SKU.TEXT_SEARCH_PRO,
  SKU.PLACE_DETAILS_PRO,
  SKU.PLACE_DETAILS_ESSENTIALS
]
const NEARBY_UNLOCK_SKUS = [
  ...AUTOCOMPLETE_UNLOCK_SKUS,
  SKU.AUTOCOMPLETE_REQUESTS
]
if (!API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before matching locations.')

const admin = createAdminClient()
const exhaustedSkus = new Set()
const requests = {
  textSearchPro: 0,
  textSearchIdsOnly: 0,
  placeDetailsPro: 0,
  placeDetailsEssentials: 0,
  autocompleteRequests: 0,
  nearbySearchPro: 0
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function normalizedLocation(location) {
  return {
    ...location,
    addressPublic: location.addressPublic ?? location.address_public ?? null,
    candidatePlaceIds: location.candidatePlaceIds ?? location.candidate_place_ids ?? []
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
  const [includedType] = googlePrimaryTypesForKind(location.kind)
  if (includedType) body.includedType = includedType
  if (/^[A-Z]{2}$/.test(String(location.country_code || ''))) body.regionCode = location.country_code
  return body
}

function googleAutocompleteBody(location) {
  const body = {
    input: [location.name, location.addressPublic, location.city, location.region, location.country].filter(Boolean).join(', '),
    languageCode: 'en',
    includeQueryPredictions: false,
    origin: {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude)
    },
    locationRestriction: {
      circle: {
        center: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        radius: 500
      }
    }
  }
  const includedPrimaryTypes = googlePrimaryTypesForKind(location.kind)
  if (includedPrimaryTypes.length) body.includedPrimaryTypes = includedPrimaryTypes
  if (/^[A-Z]{2}$/.test(String(location.country_code || ''))) body.regionCode = location.country_code.toLowerCase()
  return body
}

function googleNearbyBody(location, typed = true) {
  const body = {
    languageCode: 'en',
    maxResultCount: 10,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        radius: 180
      }
    }
  }
  const includedPrimaryTypes = googlePrimaryTypesForKind(location.kind)
  if (typed && includedPrimaryTypes.length) body.includedPrimaryTypes = includedPrimaryTypes
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

function observeBudget(budget) {
  if (!budget?.sku) return
  if (Number(budget.remaining) <= 0) exhaustedSkus.add(budget.sku)
  else exhaustedSkus.delete(budget.sku)
}

function autocompleteUnlocked() {
  return AUTOCOMPLETE_UNLOCK_SKUS.every((sku) => exhaustedSkus.has(sku))
}

function nearbyUnlocked() {
  return NEARBY_UNLOCK_SKUS.every((sku) => exhaustedSkus.has(sku))
}

async function loadExhaustedSkuState() {
  const result = await admin.rpc('google_places_free_sku_usage_v1')
  if (result.error) throw result.error
  for (const row of result.data || []) observeBudget({ sku: row.sku, remaining: row.remaining })
}

async function reserveSku(sku) {
  const result = await admin.rpc('reserve_google_places_free_sku_v1', { target_sku: sku })
  if (result.error) throw result.error
  const budget = result.data || { allowed: false, sku, remaining: 0 }
  observeBudget(budget)
  return budget
}

async function releaseSku(sku) {
  const result = await admin.rpc('release_google_places_free_sku_v1', { target_sku: sku })
  if (result.error) {
    console.warn(`Could not release ${sku} quota reservation: ${result.error.message}`)
    return
  }
  exhaustedSkus.delete(sku)
}

function countSuccessfulRequest(sku) {
  if (sku === SKU.TEXT_SEARCH_PRO) requests.textSearchPro += 1
  else if (sku === SKU.PLACE_DETAILS_PRO) requests.placeDetailsPro += 1
  else if (sku === SKU.PLACE_DETAILS_ESSENTIALS) requests.placeDetailsEssentials += 1
  else if (sku === SKU.AUTOCOMPLETE_REQUESTS) requests.autocompleteRequests += 1
  else if (sku === SKU.NEARBY_SEARCH_PRO) requests.nearbySearchPro += 1
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
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types'
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
    ? 'id,displayName,formattedAddress,location,primaryType,types'
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

async function searchGoogleAutocomplete(location) {
  return requestJson('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'suggestions.placePrediction.placeId',
        'suggestions.placePrediction.structuredFormat.mainText.text',
        'suggestions.placePrediction.structuredFormat.secondaryText.text',
        'suggestions.placePrediction.distanceMeters'
      ].join(',')
    },
    body: JSON.stringify(googleAutocompleteBody(location))
  }, { sku: SKU.AUTOCOMPLETE_REQUESTS, label: 'Google Autocomplete' })
}

async function searchGoogleNearby(location, typed = true) {
  return requestJson('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types'
    },
    body: JSON.stringify(googleNearbyBody(location, typed))
  }, { sku: SKU.NEARBY_SEARCH_PRO, label: 'Google Nearby Search Pro' })
}

function rankedRichMatches(location, places) {
  return (places || [])
    .map((place) => ({ place, match: scoreGooglePlaceMatch(location, place) }))
    .filter((entry) => entry.match)
    .sort((a, b) => b.match.score - a.match.score)
}

function uniquePlaceIds(payload, preDiscovered = []) {
  return [...new Set([
    ...(preDiscovered || []).map((value) => String(value || '').trim()),
    ...(payload?.places || []).map((place) => String(place?.id || '').trim())
  ].filter(Boolean))].slice(0, MAX_DETAILS_CANDIDATES)
}

function autocompletePredictions(payload) {
  return (payload?.suggestions || [])
    .map((suggestion) => suggestion?.placePrediction)
    .filter((prediction) => String(prediction?.placeId || '').trim())
}

function chooseUnambiguousNearby(location, places) {
  const matches = (places || [])
    .map((place) => ({ place, match: scoreGoogleNearbyPlaceMatch(location, place) }))
    .filter((entry) => entry.match && entry.match.score >= MIN_SCORE)
    .sort((a, b) => b.match.score - a.match.score)
  if (!matches.length) return null
  if (matches.length > 1 && matches[0].match.score - matches[1].match.score < 0.05) return { ambiguous: true }
  return matches[0]
}

async function findNearbyMatch(location) {
  if (!nearbyUnlocked()) return { status: 'quota_deferred', mode: 'nearby_locked' }
  const hasTypes = googlePrimaryTypesForKind(location.kind).length > 0
  const typed = await searchGoogleNearby(location, hasTypes)
  if (typed.exhausted) return { status: 'quota_deferred', mode: 'nearby_search_pro' }

  let best = chooseUnambiguousNearby(location, typed.payload?.places)
  if (best?.ambiguous) return { status: 'no_match', mode: 'nearby_search_pro_ambiguous' }
  if (best) return { status: 'matched', place: best.place, match: best.match, mode: 'nearby_search_pro' }

  if (hasTypes) {
    const untyped = await searchGoogleNearby(location, false)
    if (untyped.exhausted) return { status: 'quota_deferred', mode: 'nearby_search_pro' }
    best = chooseUnambiguousNearby(location, untyped.payload?.places)
    if (best?.ambiguous) return { status: 'no_match', mode: 'nearby_search_pro_untyped_ambiguous' }
    if (best) return { status: 'matched', place: best.place, match: best.match, mode: 'nearby_search_pro_untyped' }
  }
  return { status: 'no_match', mode: 'nearby_search_pro' }
}

async function findAutocompleteMatch(location) {
  if (!String(location.addressPublic || '').trim()) {
    if (nearbyUnlocked()) return findNearbyMatch(location)
    return { status: 'no_match', mode: 'autocomplete_ineligible' }
  }

  const autocomplete = await searchGoogleAutocomplete(location)
  if (autocomplete.exhausted) return findNearbyMatch(location)

  const matches = autocompletePredictions(autocomplete.payload)
    .map((prediction) => ({
      prediction,
      match: scoreGoogleAutocompletePrediction(location, prediction)
    }))
    .filter((entry) => entry.match && entry.match.score >= MIN_SCORE)

  if (matches.length === 1) {
    return {
      status: 'matched',
      place: { id: matches[0].prediction.placeId },
      match: matches[0].match,
      mode: 'autocomplete'
    }
  }
  if (matches.length > 1) return { status: 'no_match', mode: 'autocomplete_ambiguous' }
  return { status: 'no_match', mode: 'autocomplete' }
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
  const ids = uniquePlaceIds(idsSearch.payload, location.candidatePlaceIds)
  if (!ids.length) {
    if (autocompleteUnlocked()) return findAutocompleteMatch(location)
    return { status: 'no_match', mode: 'ids_only' }
  }

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
  if (proExhaustedAt === ids.length) {
    if (autocompleteUnlocked()) return findAutocompleteMatch(location)
    return { status: 'no_match', mode: 'ids_only_place_details_pro' }
  }

  const remainingIds = ids.slice(proExhaustedAt)
  const essentialsMatches = []
  for (let index = 0; index < remainingIds.length; index += 1) {
    const detail = await googlePlaceDetails(remainingIds[index], SKU.PLACE_DETAILS_ESSENTIALS)
    if (detail.exhausted) {
      if (autocompleteUnlocked()) return findAutocompleteMatch(location)
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
  if (autocompleteUnlocked()) return findAutocompleteMatch(location)
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

async function nextMonthRetry() {
  const result = await admin.rpc('google_places_next_free_reset_v1')
  if (result.error) throw result.error
  return result.data || new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
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

await loadExhaustedSkuState()
const quotaResetAt = await nextMonthRetry()

let locations
if (locationArgument) {
  const result = await admin
    .from('locations')
    .select('id,name,kind,latitude,longitude,city,region,country,country_code,address_public')
    .eq('id', locationArgument)
    .maybeSingle()
  if (result.error) throw result.error
  if (result.data) {
    const candidates = await admin.rpc('google_place_candidate_ids_v1', {
      target_location_id: result.data.id,
      max_candidates: MAX_DETAILS_CANDIDATES
    })
    if (candidates.error) throw candidates.error
    locations = [{
      ...result.data,
      attempt_count: 0,
      candidate_place_ids: (candidates.data || []).map((candidate) => candidate.google_place_id)
    }]
  } else locations = []
} else {
  const result = await admin.rpc('claim_google_place_candidates_v3', { batch_size: LIMIT })
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
        retryAfterValue: quotaResetAt
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
    const distanceLabel = Number.isFinite(Number(result.match.distanceM)) ? `${Number(result.match.distanceM).toFixed(1)} m` : 'distance n/a'
    console.log(`${APPLY ? 'Saving' : 'Would save'} ${location.name} → ${matchedName || result.place.id} (${result.match.score.toFixed(3)}, ${distanceLabel}, ${result.mode}).`)
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
      const candidateCleanup = await admin.from('google_place_id_candidates').delete().eq('location_id', location.id)
      if (candidateCleanup.error) throw candidateCleanup.error
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
