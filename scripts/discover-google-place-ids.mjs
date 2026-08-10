import { createAdminClient } from '../lib/supabase/admin.js'
import {
  googleIdsOnlyQueryVariants,
  googlePrimaryTypesForKind
} from '../lib/app/google-place-discovery.js'

const APPLY = process.argv.includes('--apply')
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.GOOGLE_PLACE_DISCOVERY_LIMIT || 1_000)))
const API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_DISCOVERY_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(25, Math.min(2_000, Number(process.env.GOOGLE_PLACE_DISCOVERY_DELAY_MS || 80)))
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504])

if (!API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before discovering Google Place IDs.')
const admin = createAdminClient()

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function normalizedLocation(location) {
  return {
    ...location,
    addressPublic: location.addressPublic ?? location.address_public ?? null
  }
}

function retryAfterMilliseconds(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1_000)
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

function searchBody(location, textQuery) {
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
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.id'
        },
        body: JSON.stringify(searchBody(location, variant.query)),
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

const claimed = await admin.rpc('claim_google_place_discovery_candidates_v1', { batch_size: LIMIT })
if (claimed.error) throw claimed.error
const locations = claimed.data || []

let queries = 0
let candidatesSeen = 0
let recorded = 0
let failures = 0
for (const rawLocation of locations) {
  const location = normalizedLocation(rawLocation)
  const variants = googleIdsOnlyQueryVariants(location)
  for (const variant of variants) {
    try {
      const payload = await searchIdsOnly(location, variant)
      queries += 1
      const ids = [...new Set((payload?.places || [])
        .map((place) => String(place?.id || '').trim())
        .filter(Boolean))].slice(0, 5)
      candidatesSeen += ids.length
      for (const googlePlaceId of ids) {
        await recordCandidate(location.id, googlePlaceId, variant.key)
        if (APPLY) recorded += 1
      }
    } catch (error) {
      failures += 1
      console.warn(`${location.name} (${variant.key}): ${error.message}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  inspected: locations.length,
  queries,
  candidatesSeen,
  recorded,
  failures
}, null, 2))
if (!APPLY) console.log('Dry run only. IDs-only requests are sent, but candidate evidence is not persisted without --apply.')
