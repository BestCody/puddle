import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createProviderRequestLimiter } from '../../lib/app/provider-request-limiter.js'

const root = fileURLToPath(new URL('../..', import.meta.url))

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('provider limiter spaces request starts and respects a shared pause', async () => {
  let now = 0
  const limiter = createProviderRequestLimiter({
    nowFn: () => now,
    sleepFn: async (milliseconds) => { now += milliseconds }
  })

  const first = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 350 })
  first()
  const second = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 350 })
  second()
  assert.equal(now, 350)

  limiter.defer('wikimedia', 1_000)
  const third = await limiter.acquire('wikimedia', { maxConcurrent: 3, minIntervalMs: 350 })
  third()
  assert.equal(now, 1_350)
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

test('open-photo workflow keeps the backlog near-continuous and provider aware', async () => {
  const workflow = await source('.github/workflows/photo-enrichment.yml')
  const importer = await source('scripts/import-open-location-photos.mjs')
  const candidates = await source('lib/app/open-photo-candidates.js')

  assert.match(workflow, /cron: '17 \*\/2 \* \* \*'/)
  assert.match(workflow, /PHOTO_ENRICH_MAX_RUNTIME_MINUTES: '110'/)
  assert.match(workflow, /OPEN_PHOTO_WIKIMEDIA_MIN_INTERVAL_MS: '350'/)
  assert.match(workflow, /OPEN_PHOTO_WIKIMEDIA_MAX_CONCURRENCY: '3'/)
  assert.match(workflow, /OPEN_PHOTO_MAPILLARY_MAX_CONCURRENCY: '12'/)
  assert.match(workflow, /KARTAVIEW_ACCESS_TOKEN: \$\{\{ secrets\.KARTAVIEW_ACCESS_TOKEN \}\}/)

  assert.match(importer, /KARTAVIEW_TOKEN \? 4_000 : 40_000/)
  assert.match(importer, /provider: 'wikimedia-api'/)
  assert.match(importer, /provider: 'mapillary-api'/)
  assert.match(importer, /provider: 'kartaview-api'/)
  assert.match(importer, /OPEN_PHOTO_LOCATION_CONCURRENCY, 24/)

  assert.match(candidates, /return \['mapillary', 'wikimedia-commons', 'kartaview'\]/)
})
