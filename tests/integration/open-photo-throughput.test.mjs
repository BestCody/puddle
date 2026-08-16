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

test('transitional photo queue writes to B2 and consumes full configured provider entitlements', async () => {
  const workflow = await source('.github/workflows/photo-enrichment.yml')
  const importer = await source('scripts/import-open-location-photos.mjs')
  const storage = await source('lib/app/open-photo-supabase.js')

  assert.match(workflow, /cron: '17 \* \* \* \*'/)
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
  assert.match(storage, /production writes are now B2-only/)
  assert.match(storage, /import\('\.\/open-photo-b2\.js'\)/)
})

test('global photo enrichment is coverage-first instead of one request per POI', async () => {
  const workflow = await source('.github/workflows/global-photo-enrichment.yml')
  const wikimedia = await source('scripts/global-data/build_wikimedia_candidates.py')
  const mapillary = await source('scripts/global-data/build_mapillary_candidates.py')
  const kartaview = await source('scripts/global-data/build_kartaview_candidates.py')
  const kartaWorkflow = await source('.github/workflows/global-kartaview-enrichment.yml')
  const materializer = await source('scripts/global-data/materialize_photo_candidates.py')

  assert.match(workflow, /GLOBAL_PHOTO_PIPELINE_ENABLED/)
  assert.match(workflow, /WIKIMEDIA_REQUESTS_PER_MINUTE/)
  assert.match(workflow, /MAPILLARY_TILE_CONCURRENCY/)
  assert.match(workflow, /GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY/)
  assert.match(wikimedia, /occupied Wikimedia cells/)
  assert.match(wikimedia, /REQUESTS_PER_MINUTE = max\(1, min\(2000/)
  assert.match(mapillary, /zoom-14 vector tiles/)
  assert.match(mapillary, /ThreadPoolExecutor\(max_workers=CONCURRENCY\)/)
  assert.match(kartaview, /REQUESTS_PER_HOUR = max\(1, min\(1000 if TOKEN else 100/)
  assert.match(kartaWorkflow, /KARTAVIEW_REQUESTS_PER_HOUR: '1000'/)
  assert.match(materializer, /existing_photos/)
  assert.match(materializer, /photos\/by-sha256/)
})
