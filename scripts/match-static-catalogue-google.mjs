import { createAdminClient } from '../lib/supabase/admin.js'
import { b2Configuration, b2Request, deleteB2Object } from '../lib/app/b2-s3.js'
import { scoreGooglePlaceMatch } from '../lib/app/google-place-match.js'
import {
  isEnrichmentStateSettled,
  mergeEnrichmentStatus
} from '../lib/app/static-catalogue-launch.js'
import {
  loadStaticReleasePlan,
  putB2Json,
  readStaticEnrichmentTile,
  readStaticReleaseTile,
  readStaticWorkerCheckpoint,
  resetStaticWorkerCheckpoint,
  statusForLocation,
  writeStaticEnrichmentTile,
  writeStaticWorkerCheckpoint
} from '../lib/app/static-catalogue-release.js'
import {
  DEFAULT_GOOGLE_REQUEST_BUDGET,
  DEFAULT_PROVIDER_FAILURE_LIMIT,
  DEFAULT_SUPABASE_LAUNCH_MAX_BYTES,
  appendSettlementReason,
  googleBudgetObjectKey,
  launchLimit,
  nextProviderFailure
} from '../lib/app/static-launch-guards.js'
import { syncStaticMediaOverlayRecords } from '../lib/app/static-media-overlay.js'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const RESET = argv.includes('--reset-checkpoint')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim() || null
const LIMIT = Math.max(1, Math.min(5_000_000, Number(option('limit', process.env.STATIC_GOOGLE_MATCH_LIMIT || 100_000))))
const MAX_TILES = Math.max(1, Math.min(100_000, Number(option('max-tiles', process.env.STATIC_GOOGLE_MATCH_MAX_TILES || 1_000))))
const MIN_SCORE = Math.max(0.75, Math.min(0.99, Number(process.env.GOOGLE_PLACE_MATCH_MIN_SCORE || 0.86)))
const REQUEST_BUDGET = launchLimit(
  option('request-budget', process.env.STATIC_GOOGLE_REQUEST_BUDGET),
  DEFAULT_GOOGLE_REQUEST_BUDGET,
  { minimum: 0, maximum: 1_000_000 }
)
const DATABASE_MAX_BYTES = launchLimit(
  option('supabase-max-bytes', process.env.SUPABASE_LAUNCH_MAX_BYTES),
  DEFAULT_SUPABASE_LAUNCH_MAX_BYTES,
  { minimum: 1 }
)
const MAX_FAILURE_ATTEMPTS = launchLimit(
  option('max-failure-attempts', process.env.STATIC_ENRICHMENT_MAX_FAILURE_ATTEMPTS),
  DEFAULT_PROVIDER_FAILURE_LIMIT,
  { minimum: 1, maximum: 20 }
)
const API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
const REQUEST_TIMEOUT_MS = Math.max(3_000, Math.min(30_000, Number(process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS || 12_000)))
const REQUEST_DELAY_MS = Math.max(100, Math.min(5_000, Number(process.env.GOOGLE_PLACE_MATCH_DELAY_MS || 250)))
const config = b2Configuration()
if (APPLY && REQUEST_BUDGET > 0 && !API_KEY) throw new Error('Set the server-only GOOGLE_PLACES_API_KEY before matching static locations.')
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

async function databaseBytes(admin) {
  const result = await admin.rpc('static_catalogue_launch_database_bytes_v1')
  if (result.error) throw result.error
  const raw = Array.isArray(result.data) ? result.data[0] : result.data
  return Number(raw || 0)
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

async function readGoogleBudget(release) {
  const response = await b2Request({ method: 'GET', key: googleBudgetObjectKey(release), config })
  if (response.status === 404) return { requestsUsed: 0 }
  if (!response.ok) throw new Error(`Backblaze B2 Google budget read failed: ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.v) !== 1 || String(payload?.release) !== String(release)) return { requestsUsed: 0 }
  return { requestsUsed: Math.max(0, Number(payload.requestsUsed || 0)) }
}

async function writeGoogleBudget(release, budget) {
  return putB2Json(googleBudgetObjectKey(release), {
    v: 1,
    release,
    requestsUsed: Math.max(0, Number(budget.requestsUsed || 0)),
    requestBudget: REQUEST_BUDGET,
    updatedAt: new Date().toISOString()
  }, { config, cacheControl: 'no-store' })
}

function skippedStatus(current, reason) {
  return mergeEnrichmentStatus(current, {
    googleState: 'skipped',
    googleAttemptedAt: current.googleAttemptedAt || new Date().toISOString(),
    googleError: appendSettlementReason(current.googleError, reason)
  })
}

const admin = createAdminClient()
const plan = await loadStaticReleasePlan({ release: RELEASE, config })
if (RESET && APPLY) {
  await resetStaticWorkerCheckpoint(plan.release, 'google', { config })
  await deleteB2Object(googleBudgetObjectKey(plan.release), { config })
}
const checkpoint = await readStaticWorkerCheckpoint(plan.release, 'google', { config })
const budget = await readGoogleBudget(plan.release)
const totals = {
  inspected: 0,
  attempted: 0,
  apiRequests: 0,
  wouldRequest: 0,
  matched: 0,
  noMatch: 0,
  retryableFailures: 0,
  terminalFailures: 0,
  photoSkipped: 0,
  budgetSkipped: 0,
  databaseSkipped: 0,
  skipped: 0,
  completedTiles: 0
}
let stop = false
let databaseExhausted = false

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
    if (relation(existing?.media_objects)?.public_url) {
      totals.photoSkipped += 1
      if (APPLY) {
        enrichment.statuses.set(place.staticLocationId, skippedStatus(current, 'open_photo_available'))
        await syncStaticMediaOverlayRecords([overlayRecord(place, existing)], { config, zoom: place.tile.z })
        changed = true
      } else {
        console.log(`Would skip Google for ${place.name}: open photo already exists.`)
      }
      continue
    }

    if (existing?.google_place_id) {
      totals.matched += 1
      if (APPLY) {
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          googleState: 'matched', googleAttemptedAt: new Date().toISOString(), googleError: null
        }))
        await syncStaticMediaOverlayRecords([overlayRecord(place, existing)], { config, zoom: place.tile.z })
        changed = true
      }
      continue
    }

    if (budget.requestsUsed >= REQUEST_BUDGET) {
      totals.budgetSkipped += 1
      if (APPLY) {
        enrichment.statuses.set(place.staticLocationId, skippedStatus(current, 'launch_google_budget_exhausted'))
        changed = true
      }
      continue
    }

    if (!databaseExhausted) databaseExhausted = (await databaseBytes(admin)) >= DATABASE_MAX_BYTES
    if (databaseExhausted) {
      totals.databaseSkipped += 1
      if (APPLY) {
        enrichment.statuses.set(place.staticLocationId, skippedStatus(current, 'supabase_database_budget_exhausted'))
        changed = true
      }
      continue
    }

    if (!APPLY) {
      totals.wouldRequest += 1
      console.log(`Would search Google for ${place.name}; ${REQUEST_BUDGET - budget.requestsUsed} persisted requests remain.`)
      continue
    }

    let working = current
    while (!isEnrichmentStateSettled(working.googleState)) {
      if (budget.requestsUsed >= REQUEST_BUDGET) {
        totals.budgetSkipped += 1
        working = skippedStatus(working, 'launch_google_budget_exhausted_during_retry')
        enrichment.statuses.set(place.staticLocationId, working)
        changed = true
        break
      }
      databaseExhausted = (await databaseBytes(admin)) >= DATABASE_MAX_BYTES
      if (databaseExhausted) {
        totals.databaseSkipped += 1
        working = skippedStatus(working, 'supabase_database_budget_exhausted_during_retry')
        enrichment.statuses.set(place.staticLocationId, working)
        changed = true
        break
      }

      totals.attempted += 1
      budget.requestsUsed += 1
      await writeGoogleBudget(plan.release, budget)
      totals.apiRequests += 1

      try {
        const payload = await searchGoogle(place)
        const ranked = (payload?.places || [])
          .map((candidate) => ({ place: candidate, match: scoreGooglePlaceMatch(place, candidate) }))
          .filter((entry) => entry.match)
          .sort((a, b) => b.match.score - a.match.score)
        const best = ranked[0]
        if (!best || best.match.score < MIN_SCORE) {
          totals.noMatch += 1
          working = mergeEnrichmentStatus(working, {
            googleState: 'no_match', googleAttemptedAt: new Date().toISOString(), googleError: null
          })
          enrichment.statuses.set(place.staticLocationId, working)
          changed = true
          console.log(`No verified Google match: ${place.name}`)
        } else {
          databaseExhausted = (await databaseBytes(admin)) >= DATABASE_MAX_BYTES
          if (databaseExhausted) {
            totals.databaseSkipped += 1
            working = skippedStatus(working, 'supabase_database_budget_exhausted_after_search')
          } else {
            totals.matched += 1
            console.log(`Saving ${place.name} → ${best.match.matchedName} (${best.match.score.toFixed(3)}).`)
            await saveMatch(admin, place, best)
            working = mergeEnrichmentStatus(working, {
              googleState: 'matched', googleAttemptedAt: new Date().toISOString(), googleError: null
            })
          }
          enrichment.statuses.set(place.staticLocationId, working)
          changed = true
        }
      } catch (error) {
        const failure = nextProviderFailure(working.googleError, error.message, MAX_FAILURE_ATTEMPTS)
        working = mergeEnrichmentStatus(working, {
          googleState: failure.state,
          googleAttemptedAt: new Date().toISOString(),
          googleError: failure.error
        })
        enrichment.statuses.set(place.staticLocationId, working)
        changed = true
        if (failure.terminal) totals.terminalFailures += 1
        else totals.retryableFailures += 1
        console.warn(`${place.name}: ${failure.error}`)
      }
      await sleep(REQUEST_DELAY_MS)
    }
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
  requestBudget: REQUEST_BUDGET,
  requestsUsed: budget.requestsUsed,
  requestsRemaining: Math.max(0, REQUEST_BUDGET - budget.requestsUsed),
  supabaseMaxBytes: DATABASE_MAX_BYTES,
  maxFailureAttempts: MAX_FAILURE_ATTEMPTS,
  ...totals,
  checkpointTiles: checkpoint.completedTiles.size
}, null, 2))
if (!APPLY) console.log('Dry run only. No Google API requests or status writes were made.')
