import { createAdminClient } from '../lib/supabase/admin.js'
import { b2Configuration } from '../lib/app/b2-s3.js'
import { storeOpenPhotoInB2 } from '../lib/app/open-photo-b2.js'
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
import {
  DEFAULT_PROVIDER_FAILURE_LIMIT,
  launchLimit,
  nextProviderFailure
} from '../lib/app/static-launch-guards.js'
import {
  downloadStaticOpenPhotoCandidate,
  findStaticOpenPhotoCandidates
} from '../lib/app/static-open-photo-provider.js'
import { syncStaticMediaOverlayRecords } from '../lib/app/static-media-overlay.js'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const RESET = argv.includes('--reset-checkpoint')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim() || null
const LIMIT = Math.max(1, Math.min(5_000_000, Number(option('limit', process.env.STATIC_PHOTO_ENRICH_LIMIT || 100_000))))
const MAX_TILES = Math.max(1, Math.min(100_000, Number(option('max-tiles', process.env.STATIC_PHOTO_ENRICH_MAX_TILES || 1_000))))
const MIN_SCORE = Math.max(0.6, Math.min(0.98, Number(process.env.OPEN_PHOTO_MIN_SCORE || 0.76)))
const REQUEST_DELAY_MS = Math.max(0, Math.min(5_000, Number(process.env.STATIC_PHOTO_ENRICH_DELAY_MS || 120)))
const MAX_FAILURE_ATTEMPTS = launchLimit(
  option('max-failure-attempts', process.env.STATIC_ENRICHMENT_MAX_FAILURE_ATTEMPTS),
  DEFAULT_PROVIDER_FAILURE_LIMIT,
  { minimum: 1, maximum: 20 }
)
const config = b2Configuration()
if (!config?.downloadBaseUrl) throw new Error('Backblaze B2 credentials and B2_DOWNLOAD_BASE_URL are required.')

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function relation(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function staticAsset(admin, id) {
  const result = await admin
    .from('static_location_assets')
    .select('static_location_id,source,source_place_id,photo_provider,external_photo_id,attribution_text,attribution_url,license_code,terms_url,google_place_id,google_match_score,google_matched_name,media_objects(public_url)')
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

async function saveCandidate(admin, place, candidate) {
  const source = await downloadStaticOpenPhotoCandidate(candidate)
  const stored = await storeOpenPhotoInB2(admin, source, { config })
  const result = await admin.rpc('upsert_static_location_asset_v1', {
    target_static_location: place.staticLocationId,
    import_source: place.source,
    import_source_place_id: place.sourcePlaceId,
    photo_media_object: stored.mediaObjectId,
    photo_provider_value: candidate.provider,
    external_photo_value: candidate.externalId,
    attribution_text_value: candidate.attribution,
    attribution_url_value: candidate.pageUrl,
    license_code_value: candidate.license,
    terms_url_value: candidate.licenseUrl
  })
  if (result.error) throw result.error
  const asset = await staticAsset(admin, place.staticLocationId)
  await syncStaticMediaOverlayRecords([overlayRecord(place, asset)], { config, zoom: place.tile.z })
  return { stored, asset }
}

const admin = createAdminClient()
const plan = await loadStaticReleasePlan({ release: RELEASE, config })
if (RESET && APPLY) await resetStaticWorkerCheckpoint(plan.release, 'photos', { config })
const checkpoint = await readStaticWorkerCheckpoint(plan.release, 'photos', { config })
const totals = {
  inspected: 0,
  attempted: 0,
  matched: 0,
  imported: 0,
  noMatch: 0,
  retryableFailures: 0,
  terminalFailures: 0,
  skipped: 0,
  completedTiles: 0
}
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
    if (isEnrichmentStateSettled(current.photoState)) {
      totals.skipped += 1
      continue
    }

    const existing = await staticAsset(admin, place.staticLocationId)
    if (relation(existing?.media_objects)?.public_url) {
      enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
        photoState: 'matched', photoAttemptedAt: new Date().toISOString(), photoError: null
      }))
      changed = true
      totals.matched += 1
      if (APPLY) await syncStaticMediaOverlayRecords([overlayRecord(place, existing)], { config, zoom: place.tile.z })
      continue
    }

    totals.attempted += 1
    const failures = []
    try {
      const result = await findStaticOpenPhotoCandidates(place, { minScore: MIN_SCORE })
      failures.push(...result.failures)
      let imported = false
      for (const candidate of result.candidates) {
        console.log(`${APPLY ? 'Importing' : 'Would import'} ${place.name} from ${candidate.provider} (${candidate.score.toFixed(3)} confidence).`)
        if (!APPLY) {
          imported = true
          break
        }
        try {
          await saveCandidate(admin, place, candidate)
          imported = true
          totals.imported += 1
          break
        } catch (error) {
          failures.push(`${candidate.provider} asset ${candidate.externalId}: ${error.message}`)
          console.warn(`${place.name}: ${candidate.provider} candidate ${candidate.externalId} failed: ${error.message}`)
        }
      }
      if (imported) {
        totals.matched += 1
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          photoState: 'matched', photoAttemptedAt: new Date().toISOString(), photoError: null
        }))
      } else if (failures.length) {
        const failure = nextProviderFailure(current.photoError, failures.slice(0, 4).join(' | '), MAX_FAILURE_ATTEMPTS)
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          photoState: failure.state,
          photoAttemptedAt: new Date().toISOString(),
          photoError: failure.error
        }))
        if (failure.terminal) totals.terminalFailures += 1
        else totals.retryableFailures += 1
      } else {
        totals.noMatch += 1
        enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
          photoState: 'no_match', photoAttemptedAt: new Date().toISOString(), photoError: null
        }))
        console.log(`No high-confidence open photo: ${place.name}`)
      }
      changed = true
    } catch (error) {
      const failure = nextProviderFailure(current.photoError, error.message, MAX_FAILURE_ATTEMPTS)
      enrichment.statuses.set(place.staticLocationId, mergeEnrichmentStatus(current, {
        photoState: failure.state,
        photoAttemptedAt: new Date().toISOString(),
        photoError: failure.error
      }))
      if (failure.terminal) totals.terminalFailures += 1
      else totals.retryableFailures += 1
      changed = true
      console.warn(`${place.name}: ${failure.error}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  if (APPLY && changed) await writeStaticEnrichmentTile(plan.release, tileDescriptor, enrichment.statuses, { config })
  const tileSettled = places.every((place) => isEnrichmentStateSettled(statusForLocation(enrichment.statuses, place.staticLocationId).photoState))
  if (APPLY && tileSettled) {
    checkpoint.completedTiles.add(tileDescriptor.key)
    checkpoint.processedLocations += places.length
    totals.completedTiles += 1
  }
  if (APPLY) await writeStaticWorkerCheckpoint(plan.release, 'photos', checkpoint, { config })
  if (stop) break
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  release: plan.release,
  minimumScore: MIN_SCORE,
  maxFailureAttempts: MAX_FAILURE_ATTEMPTS,
  ...totals,
  checkpointTiles: checkpoint.completedTiles.size
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
