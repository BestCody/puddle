import { createAdminClient } from '../lib/supabase/admin.js'
import { b2Configuration } from '../lib/app/b2-s3.js'
import { scoreGooglePlaceMatch } from '../lib/app/google-place-match.js'
import {
  isEnrichmentStateSettled,
  mergeEnrichmentStatus
} from '../lib/app/static-catalogue-launch.js'
import {
  loadStaticReleasePlan,
  readStaticEnrichmentTile,
  readStaticReleaseTile,
  readStaticWorkerCheckpoint,
  resetStaticWorkerCheckpoint,
  statusForLocation,
  writeStaticEnrichmentTile,
  writeStaticWorkerCheckpoint
} from '../lib/app/static-catalogue-release.js'
import { syncStaticMediaOverlayRecords } from '../lib/app/static-media-overlay.js'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const RESET = argv.includes('--reset-checkpoint')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim() || null
const LIMIT = Math.max(1, Math.min(5_000_000, Number(option('limit', process.env.STATIC_GOOGLE_MATCH_LIMIT || 100_000))))
const MAX_TILES = Math.max(1, Math.min(100_000, Number(option('max-tiles', process.env.STATIC_GOOGLE_MATCH_MAX_TILES || 1_000))))
const MIN_SCORE = Math.max(0.75, Math.min(0.99, Number(process.env.GOOGLE_PLACE_MATCH_MIN_SCORE || 0.86)))
const API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(100, Math.min(5_000, Number(process.env.GOOGLE_PLACE_MATCH_DELAY_MS || 250)))
const config = b2Configuration()
if (!API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before matching static locations.')
if (!config) throw new Error('Backblaze B2 credentials are required.')

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
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
  if (/^[A-Z]{2}$/.test(String(location.countryCode || ''))) body.regionCode = location.countryCode
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

function relation(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function staticAsset(admin, id) {
  const result = await admin
    .from('static_location_assets')
    .select('static_location_id,source,source_place_id,photo_provider,attribution_text,attribution_url,license_code,google_place_id,google_match_score,google_matched_name,media_objects(public_url)')
    .eq('static_location_id', id)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  return result.data || null
}

function overlayRecord(place, asset) {
  const media = relation(asset?.media_objects)
  return {
    staticLocationId: place.staticLocationId,
    latitude: place.latitude,
    longitude: place.longitude,
    photoUrl: media?.public_url || null,
    photoProvider: asset?.photo_provider || null,
    attributionText: asset?.attribution_text || null,
    attributionUrl: asset?.attribution_url || null,
    licenseCode: asset?.license_code || null,
    googlePlaceId: asset?.google_place_id || null,
    googleMatchScore: asset?.google_match_score ?? null
  }
}

async function saveMatch(admin, place, best) {
  const result = await admin.rpc('upsert_static_location_asset_v1', {
    target_static_location: place.staticLocationId,
    import_source: place.source,
    import_source_place_id: place.sourcePlaceId,
    google_place_value: best.place.id,
    google_score_value: Number(best.match.score.toFixed(4)),
    google_name_value: best.match.matchedName
  })
  if (result.error) throw result.error
  const asset = await staticAsset(admin, place.staticLocationId)
  await syncStaticMediaOverlayRecords([overlayRecord(place, asset)], { config, zoom: place.tile.z })
}

const admin = createAdminClient()
const plan = await loadStaticReleasePlan({ release: RELEASE, config })
if (RESET && APPLY) await resetStaticWorkerCheckpoint(plan.release, 'google', { config })
const checkpoint = await readStaticWorkerCheckpoint(plan.release, 'google', { config })
const totals = { inspected: 0, attempted: 0, matched: 0, noMatch: 0, failed: 0, skipped: 0, completedTiles: 0 }
let stop = false

for (const tileDescriptor of plan.tiles.slice(0, MAX_TILES)) {
  if (checkpoint.completedTiles.has(tileDescriptor.key)) {
    totals.skipped += Number(tileDescriptor.places || 0)
    continue
  }
  const [{ places }, enrichment] = await Promise.all([
    readStaticReleaseTile(plan.release, tileDescriptor, { config }),
    readStaticEnrichmentTile(plan.release, tileDescriptor, { config })
  ])
  let changed = false
  for (const place of places) {
    if (totals.inspected >= LIMIT) { stop = true; break }
    totals.inspected += 1
    const current = statusForLocation(enrichment.statuses, place.staticLocationId)
    if (isEnrichmentStateSettled(current.googleState)) {
      totals.skipped += 1
      continue
    }

    const existing = await staticAsset(admin, place.staticLocationId)
    if (existing?.google_place_id) {
      enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
        googleState: 'matched', googleAttemptedAt: new Date().toISOString(), googleError: null
      }))
      changed = true
      totals.matched += 1
      if (APPLY) await syncStaticMediaOverlayRecords([overlayRecord(place, existing)], { config, zoom: place.tile.z })
      continue
    }

    totals.attempted += 1
    try {
      const payload = await searchGoogle(place)
      const ranked = (payload?.places || [])
        .map((candidate) => ({ place: candidate, match: scoreGooglePlaceMatch(place, candidate) }))
        .filter((entry) => entry.match)
        .sort((a, b) => b.match.score - a.match.score)
      const best = ranked[0]
      if (!best || best.match.score < MIN_SCORE) {
        totals.noMatch += 1
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          googleState: 'no_match', googleAttemptedAt: new Date().toISOString(), googleError: null
        }))
        changed = true
        console.log(`No verified Google match: ${place.name}`)
      } else {
        totals.matched += 1
        console.log(`${APPLY ? 'Saving' : 'Would save'} ${place.name} → ${best.match.matchedName} (${best.match.score.toFixed(3)}).`)
        if (APPLY) await saveMatch(admin, place, best)
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          googleState: 'matched', googleAttemptedAt: new Date().toISOString(), googleError: null
        }))
        changed = true
      }
    } catch (error) {
      totals.failed += 1
      enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
        googleState: 'retryable_failure', googleAttemptedAt: new Date().toISOString(), googleError: error.message
      }))
      changed = true
      console.warn(`${place.name}: ${error.message}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  if (APPLY && changed) await writeStaticEnrichmentTile(plan.release, tileDescriptor, enrichment.statuses, { config })
  const tileSettled = places.every((place) => isEnrichmentStateSettled(statusForLocation(enrichment.statuses, place.staticLocationId).googleState))
  if (APPLY && tileSettled) {
    checkpoint.completedTiles.add(tileDescriptor.key)
    checkpoint.processedLocations += places.length
    totals.completedTiles += 1
  }
  if (APPLY) await writeStaticWorkerCheckpoint(plan.release, 'google', checkpoint, { config })
  if (stop) break
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  release: plan.release,
  minimumScore: MIN_SCORE,
  ...totals,
  checkpointTiles: checkpoint.completedTiles.size
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
