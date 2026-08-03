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

const admin = createAdminClient()
let query = admin
  .from('locations')
  .select('id,name,latitude,longitude,city,region,country,country_code,status,visibility,published_at')
  .eq('status', 'published')
  .eq('visibility', 'public')
  .not('latitude', 'is', null)
  .not('longitude', 'is', null)
  .order('published_at', { ascending: false })
  .limit(LIMIT)
if (locationArgument) query = query.eq('id', locationArgument)
const { data: locations, error: locationsError } = await query
if (locationsError) throw locationsError

let matched = 0
let saved = 0
let skipped = 0
let photographed = 0
let failed = 0
for (const location of locations || []) {
  const [existing, photos] = await Promise.all([
    admin.from('location_google_places').select('google_place_id,status').eq('location_id', location.id).maybeSingle(),
    admin.from('location_photo_sources').select('id').eq('location_id', location.id).eq('status', 'approved').limit(1)
  ])
  if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
  if (photos.error) throw photos.error
  if (photos.data?.length) {
    photographed += 1
    continue
  }
  if (existing.data?.status === 'verified') {
    skipped += 1
    continue
  }
  try {
    const payload = await searchGoogle(location)
    const ranked = (payload?.places || [])
      .map((place) => ({ place, match: scoreGooglePlaceMatch(location, place) }))
      .filter((entry) => entry.match)
      .sort((a, b) => b.match.score - a.match.score)
    const best = ranked[0]
    if (!best || best.match.score < MIN_SCORE) {
      console.log(`No verified Google match: ${location.name}`)
      await sleep(REQUEST_DELAY_MS)
      continue
    }
    matched += 1
    console.log(`${APPLY ? 'Saving' : 'Would save'} ${location.name} → ${best.match.matchedName} (${best.match.score.toFixed(3)}, ${best.match.distanceM.toFixed(1)} m).`)
    if (APPLY) {
      const { error } = await admin.from('location_google_places').upsert({
        location_id: location.id,
        google_place_id: best.place.id,
        status: 'verified',
        match_score: Number(best.match.score.toFixed(4)),
        matched_name: best.match.matchedName,
        matched_at: new Date().toISOString()
      }, { onConflict: 'location_id' })
      if (error) throw error
      saved += 1
    }
  } catch (error) {
    failed += 1
    console.warn(`${location.name}: ${error.message}`)
  }
  await sleep(REQUEST_DELAY_MS)
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run', inspected: locations?.length || 0,
  matched, saved, skipped, photographed, failed, minimumScore: MIN_SCORE
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
