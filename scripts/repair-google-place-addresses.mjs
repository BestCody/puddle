import { createAdminClient } from '../lib/supabase/admin.js'
import {
  googleIdsOnlyQueryVariants,
  googlePrimaryTypesForKind
} from '../lib/app/google-place-discovery.js'

const APPLY = process.argv.includes('--apply')
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.GOOGLE_PLACE_GEOCODE_LIMIT || 1_000)))
const PLACES_API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const GEOCODING_API_KEY = String(process.env.GOOGLE_GEOCODING_API_KEY || PLACES_API_KEY).trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_GEOCODE_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(25, Math.min(2_000, Number(process.env.GOOGLE_PLACE_GEOCODE_DELAY_MS || 100)))
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504])
const GEOCODING_SKU = 'geocoding'

if (!PLACES_API_KEY) throw new Error('Set GOOGLE_PLACES_API_KEY before seeding Google Place ID candidates.')
if (!GEOCODING_API_KEY) throw new Error('Set GOOGLE_GEOCODING_API_KEY or GOOGLE_PLACES_API_KEY before reverse geocoding.')
const admin = createAdminClient()

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function retryAfterMilliseconds(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1_000)
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

async function reserveGeocoding() {
  const result = await admin.rpc('reserve_google_places_free_sku_v1', { target_sku: GEOCODING_SKU })
  if (result.error) throw result.error
  return result.data || { allowed: false, remaining: 0 }
}

async function releaseGeocoding() {
  const result = await admin.rpc('release_google_places_free_sku_v1', { target_sku: GEOCODING_SKU })
  if (result.error) console.warn(`Could not release Geocoding reservation: ${result.error.message}`)
}

async function reverseGeocode(location) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reservation = await reserveGeocoding()
    if (!reservation?.allowed) return { exhausted: true, address: null }

    let response
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
      url.searchParams.set('latlng', `${Number(location.latitude)},${Number(location.longitude)}`)
      url.searchParams.set('key', GEOCODING_API_KEY)
      response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      await releaseGeocoding()
      lastError = error
      if (attempt === 2) throw error
      await sleep(500 * (2 ** attempt))
      continue
    }

    if (!response.ok) {
      await releaseGeocoding()
      const error = new Error(`Google Geocoding returned HTTP ${response.status}.`)
      error.status = response.status
      lastError = error
      if (!RETRYABLE_HTTP.has(response.status) || attempt === 2) throw error
      await sleep(Math.max(retryAfterMilliseconds(response.headers.get('retry-after')), 750 * (2 ** attempt)))
      continue
    }

    const payload = await response.json()
    if (payload?.status === 'ZERO_RESULTS') return { exhausted: false, address: null }
    if (payload?.status !== 'OK') {
      await releaseGeocoding()
      const error = new Error(`Google Geocoding returned ${payload?.status || 'UNKNOWN_ERROR'}.`)
      lastError = error
      if (attempt === 2 || !['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR'].includes(payload?.status)) throw error
      await sleep(750 * (2 ** attempt))
      continue
    }

    const results = payload.results || []
    const preferred =
      results.find((result) => (result?.types || []).includes('street_address')) ||
      results.find((result) => (result?.types || []).includes('premise')) ||
      results.find((result) => (result?.types || []).includes('subpremise')) ||
      results[0]
    return { exhausted: false, address: String(preferred?.formatted_address || '').trim() || null }
  }
  throw lastError || new Error('Google Geocoding failed.')
}

function textSearchBody(location, textQuery) {
  const body = {
    textQuery,
    languageCode: 'en',
    pageSize: 5,
    locationBias: {
      circle: {
        center: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        radius: 250
      }
    }
  }
  const [includedType] = googlePrimaryTypesForKind(location.kind)
  if (includedType) body.includedType = includedType
  if (/^[A-Z]{2}$/.test(String(location.country_code || ''))) body.regionCode = location.country_code
  return body
}

async function searchIdsOnly(location, variant) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response
    try {
      response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id'
        },
        body: JSON.stringify(textSearchBody(location, variant.query)),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      lastError = error
      if (attempt === 2) throw error
      await sleep(500 * (2 ** attempt))
      continue
    }
    if (response.ok) return await response.json()
    const error = new Error(`Google Text Search IDs Only returned ${response.status}.`)
    error.status = response.status
    lastError = error
    if (!RETRYABLE_HTTP.has(response.status) || attempt === 2) throw error
    await sleep(Math.max(retryAfterMilliseconds(response.headers.get('retry-after')), 750 * (2 ** attempt)))
  }
  throw lastError || new Error('Google Text Search IDs Only failed.')
}

async function recordCandidate(locationId, googlePlaceId, queryVariant) {
  if (!APPLY) return
  const result = await admin.rpc('record_google_place_id_candidate_v1', {
    target_location_id: locationId,
    target_google_place_id: googlePlaceId,
    target_query_variant: queryVariant
  })
  if (result.error) throw result.error
}

async function saveAttempt(locationId, status, attemptCount, retryAfter, error = null) {
  if (!APPLY) return
  const result = await admin.from('google_place_geocode_attempts').upsert({
    location_id: locationId,
    status,
    attempt_count: attemptCount,
    last_attempt_at: new Date().toISOString(),
    retry_after: retryAfter,
    last_error: error ? String(error).slice(0, 900) : null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'location_id' })
  if (result.error) throw result.error
}

async function nextReset() {
  const result = await admin.rpc('google_places_next_free_reset_v1')
  if (result.error) throw result.error
  return result.data || new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
}

const claimed = await admin.rpc('claim_google_place_geocode_candidates_v1', { batch_size: LIMIT })
if (claimed.error) throw claimed.error
const locations = claimed.data || []
const resetAt = await nextReset()

let geocoded = 0
let seeded = 0
let idsQueries = 0
let candidatesSeen = 0
let noResult = 0
let quotaDeferred = 0
let failed = 0

for (const location of locations) {
  const attemptCount = Number(location.attempt_count || 0) + 1
  try {
    const geocode = await reverseGeocode(location)
    if (geocode.exhausted) {
      quotaDeferred += 1
      await saveAttempt(location.id, 'quota_deferred', Number(location.attempt_count || 0), resetAt)
      break
    }
    geocoded += 1

    if (!geocode.address) {
      noResult += 1
      await saveAttempt(location.id, 'no_result', attemptCount, resetAt)
      await sleep(REQUEST_DELAY_MS)
      continue
    }

    const variants = googleIdsOnlyQueryVariants(location, { addressOverride: geocode.address })
    let locationSeeds = 0
    for (const variant of variants) {
      const payload = await searchIdsOnly(location, variant)
      idsQueries += 1
      const ids = [...new Set((payload?.places || [])
        .map((place) => String(place?.id || '').trim())
        .filter(Boolean))].slice(0, 5)
      candidatesSeen += ids.length
      for (const googlePlaceId of ids) {
        await recordCandidate(location.id, googlePlaceId, `geocode_${variant.key}`)
        if (APPLY) locationSeeds += 1
      }
      await sleep(REQUEST_DELAY_MS)
    }
    seeded += locationSeeds > 0 ? 1 : 0
    await saveAttempt(location.id, locationSeeds > 0 ? 'seeded' : 'no_result', attemptCount, resetAt)
  } catch (error) {
    failed += 1
    console.warn(`${location.name}: ${error.message}`)
    const hours = Math.min(7 * 24, Math.max(1, 2 ** Math.min(8, attemptCount)))
    try {
      await saveAttempt(
        location.id,
        'failed',
        attemptCount,
        new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        error.message
      )
    } catch (attemptError) {
      console.warn(`${location.name}: could not persist geocode retry state: ${attemptError.message}`)
    }
  }
  await sleep(REQUEST_DELAY_MS)
}

const usage = await admin.rpc('google_places_free_sku_usage_v1')
if (usage.error) throw usage.error
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  inspected: locations.length,
  geocoded,
  seeded,
  idsQueries,
  candidatesSeen,
  noResult,
  quotaDeferred,
  failed,
  freeSkuUsage: usage.data || []
}, null, 2))
if (!APPLY) console.log('Dry run only. Reverse-geocoding and IDs-only requests are sent, but no candidate or retry state is persisted without --apply.')
