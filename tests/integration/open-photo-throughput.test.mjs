import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createProviderRequestLimiter } from '../../lib/app/provider-request-limiter.js'

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('provider limiter spaces request starts and respects a shared pause', async () => {
  let now = 0
  const limiter = createProviderRequestLimiter({
    nowFn: () => now,
    sleepFn: async (milliseconds) => { now += milliseconds }
  })

  const first = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 300 })
  first()
  const second = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 300 })
  second()
  assert.equal(now, 300)

  limiter.defer('wikimedia', 1_000)
  const third = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 300 })
  third()
  assert.equal(now, 1_300)
})

test('provider limiter enforces maximum concurrency', async () => {
  const limiter = createProviderRequestLimiter()
  const first = await limiter.acquire('kartaview', { maxConcurrent: 1 })
  let secondStarted = false
  const secondPromise = limiter.acquire('kartaview', { maxConcurrent: 1 }).then((release) => {
    secondStarted = true
    return release
  })

  await Promise.resolve()
  assert.equal(secondStarted, false)
  first()
  const second = await secondPromise
  assert.equal(secondStarted, true)
  second()
})

test('transitional photo queue stays manual while retaining B2 repair capability', async () => {
  const workflow = await source('.github/workflows/photo-enrichment.yml')
  const importer = await source('scripts/import-open-location-photos.mjs')
  const storage = await source('lib/app/open-photo-b2.js')

  assert.match(workflow, /cron: '17 \* \* \* \*'/)
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /B2_MEDIA_ENABLED/)
  assert.match(workflow, /B2_MEDIA_APPLICATION_KEY_ID/)
  assert.match(workflow, /Drain prioritized open-photo candidates into B2 media/)
  assert.match(workflow, /OPEN_PHOTO_WIKIMEDIA_MIN_INTERVAL_MS: '300'/)
  assert.match(workflow, /OPEN_PHOTO_WIKIMEDIA_MAX_CONCURRENCY: '3'/)
  assert.match(workflow, /OPEN_PHOTO_MAPILLARY_MAX_CONCURRENCY: '32'/)
  assert.match(workflow, /OPEN_PHOTO_KARTAVIEW_MIN_INTERVAL_MS: '3600'/)
  assert.match(workflow, /OPEN_PHOTO_LOCATION_CONCURRENCY: '100'/)

  assert.match(importer, /provider: 'wikimedia-api'/)
  assert.match(importer, /provider: 'mapillary-api'/)
  assert.match(importer, /provider: 'kartaview-api'/)
  assert.match(importer, /storeOpenPhotoInB2/)
  assert.doesNotMatch(importer, /storeOpenPhotoInSupabase|open-photo-supabase/)
  assert.match(storage, /storageBackend: 'b2'/)
  assert.match(storage, /media\/photos\/by-sha256/)
  assert.match(storage, /\.from\('media_objects'\)/)
  assert.match(storage, /mediaObjectId: mediaObject\.id/)
})

test('global free-photo workers saturate provider budgets without one request per POI', async () => {
  const materializeWorkflow = await source('.github/workflows/global-photo-enrichment.yml')
  const wikimediaWorkflow = await source('.github/workflows/global-wikimedia-enrichment.yml')
  const mapillaryWorkflow = await source('.github/workflows/global-mapillary-enrichment.yml')
  const kartaWorkflow = await source('.github/workflows/global-kartaview-enrichment.yml')
  const wikimedia = await source('scripts/global-data/build_wikimedia_candidates.py')
  const mapillary = await source('scripts/global-data/build_mapillary_candidates.py')
  const kartaview = await source('scripts/global-data/build_kartaview_candidates.py')
  const materializer = await source('scripts/global-data/materialize_photo_candidates.py')

  assert.match(materializeWorkflow, /GLOBAL_PHOTO_PIPELINE_ENABLED/)
  assert.match(materializeWorkflow, /cron: '31 \* \* \* \*'/)
  assert.match(materializeWorkflow, /GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY/)

  assert.match(wikimediaWorkflow, /WIKIMEDIA_REQUESTS_PER_MINUTE/)
  assert.match(wikimediaWorkflow, /WIKIMEDIA_MAX_CONCURRENCY: '3'/)
  assert.match(wikimedia, /REQUESTS_PER_MINUTE = max\(1, min\(2000/)
  assert.match(wikimedia, /STATE_PREFIX/)
  assert.match(wikimedia, /merge_candidates/)

  assert.match(mapillaryWorkflow, /MAPILLARY_TILE_DAILY_LIMIT: '50000'/)
  assert.match(mapillaryWorkflow, /default: '12500'/)
  assert.match(mapillary, /zoom-14 vector tiles/)
  assert.match(mapillary, /DAILY_REQUEST_LIMIT = max\(1, min\(50_000/)
  assert.match(mapillary, /STATE_PREFIX/)
  assert.match(mapillary, /quota-\{today\}\.json/)
  assert.match(mapillary, /ThreadPoolExecutor\(max_workers=CONCURRENCY\)/)

  assert.match(kartaview, /PROVIDER_HOURLY_MAX = 1000 if TOKEN else 100/)
  assert.match(kartaview, /REQUESTS_PER_HOUR = max\(1, min\(PROVIDER_HOURLY_MAX/)
  assert.match(kartaview, /photo_attempts\/provider=kartaview/)
  assert.match(kartaWorkflow, /KARTAVIEW_REQUESTS_PER_HOUR: '1000'/)

  assert.match(materializer, /existing_photos/)
  assert.match(materializer, /photos\/by-sha256/)
})
