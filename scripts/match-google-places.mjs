import { createAdminClient } from '../lib/supabase/admin.js'
import { scoreGooglePlaceMatch } from '../lib/app/google-place-match.js'

const APPLY = process.argv.includes('--apply')
const locationArgument = process.argv.find((value) => value.startsWith('--location='))?.split('=')[1] || null
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(1_000, Number(limitArgument || process.env.GOOGLE_PLACE_MATCH_LIMIT || 100)))
const MIN_SCORE = Math.max(0.75, Math.min(0.99, Number(process.env.GOOGLE_PLACE_MATCH_MIN_SCORE || 0.86)))
const API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(100, Math.min(5_000, Number(process.env.GOOGLE_PLACE_MATCH_DELAY_MS || 250)))
if (!API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before matching locations.')

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function searchGoogle(location) {
  const body = {
    textQuery: [location.name, location.city, location.region, location.country].filter(Boolean).join(', '),
    languageCode: 'en',
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        radius: 200
      }
    }
  }
  if (/^[A-Z]{2}$/.test(String(location.country_code || ''))) body.regionCode = location.country_code
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType'
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Google Places returned ${response.status}.`)
  return response.json()
}

function retryAfter(attemptCount, failed = false) {
  if (!failed) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const hours = Math.min(7 * 24, Math.max(1, 2 ** Math.min(8, Number(attemptCount || 0))))
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

const admin = createAdminClient()
let locations
if (locationArgument) {
  const result = await admin
    .from('locations')
    .select('id,name,latitude,longitude,city,region,country,country_code')
    .eq('id', locationArgument)
    .maybeSingle()
  if (result.error) throw result.error
  locations = result.data ? [{ ...result.data, attempt_count: 0 }] : []
} else {
  const result = await admin.rpc('claim_google_place_candidates_v1', { batch_size: LIMIT })
  if (result.error) throw result.error
  locations = result.data || []
}

let matched = 0
let saved = 0
let noMatch = 0
let failed = 0
for (const location of locations) {
  const attemptCount = Number(location.attempt_count || 0) + 1
  try {
    const payload = await searchGoogle(location)
    const ranked = (payload?.places || [])
      .map((place) => ({ place, match: scoreGooglePlaceMatch(location, place) }))
      .filter((entry) => entry.match)
      .sort((a, b) => b.match.score - a.match.score)
    const best = ranked[0]
    if (!best || best.match.score < MIN_SCORE) {
      noMatch += 1
      console.log(`No verified Google match: ${location.name}`)
      if (APPLY) {
        const result = await admin.from('google_place_match_attempts').upsert({
          location_id: location.id,
          status: 'no_match',
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          retry_after: retryAfter(attemptCount, false),
          last_error: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'location_id' })
        if (result.error) throw result.error
      }
      await sleep(REQUEST_DELAY_MS)
      continue
    }
    matched += 1
    console.log(`${APPLY ? 'Saving' : 'Would save'} ${location.name} → ${best.match.matchedName} (${best.match.score.toFixed(3)}, ${best.match.distanceM.toFixed(1)} m).`)
    if (APPLY) {
      const mapping = await admin.from('location_google_places').upsert({
        location_id: location.id,
        google_place_id: best.place.id,
        status: 'verified',
        match_score: Number(best.match.score.toFixed(4)),
        matched_name: best.match.matchedName,
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
    if (APPLY) {
      const result = await admin.from('google_place_match_attempts').upsert({
        location_id: location.id,
        status: 'failed',
        attempt_count: attemptCount,
        last_attempt_at: new Date().toISOString(),
        retry_after: retryAfter(attemptCount, true),
        last_error: String(error.message || 'Google Places request failed.').slice(0, 900),
        updated_at: new Date().toISOString()
      }, { onConflict: 'location_id' })
      if (result.error) throw result.error
    }
  }
  await sleep(REQUEST_DELAY_MS)
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run', inspected: locations.length,
  matched, saved, noMatch, failed, minimumScore: MIN_SCORE
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
