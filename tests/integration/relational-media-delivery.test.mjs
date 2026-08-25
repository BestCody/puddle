import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('discovery is B2-only with no degraded fallback paths into the retired relational catalogue', async () => {
  const selector = await read('lib/app/discovery.js')
  const global = await read('lib/app/discovery-global.js')
  const route = await read('app/api/discovery/route.js')

  assert.match(selector, /getGlobalDiscoveryFeed/)
  assert.doesNotMatch(selector, /global-location-stale-cache|global-location-degraded|emptyDegradedFeed/)
  assert.doesNotMatch(selector, /getRelationalDiscoveryFeed|discovery-relational|from\(['"]locations['"]\)/)
  assert.match(global, /global-location-serving/)
  assert.match(global, /searchGlobalLocations/)
  assert.match(route, /getDiscoveryFeed/)
})

test('canonical open-photo delivery is content-addressed B2 with no Supabase media registry dependency', async () => {
  const deliveryUrl = await read('lib/media/open-photo-url.js')
  const openPhotoRoute = await read('app/api/open-photo/[sha256]/route.js')
  const repositoryCheck = await read('scripts/check.mjs')

  assert.match(deliveryUrl, /normalizeOpenPhotoHash/)
  assert.match(deliveryUrl, /\/api\/open-photo\//)
  assert.match(openPhotoRoute, /canonicalStorageKey/)
  assert.match(openPhotoRoute, /media\/photos\/by-sha256\//)
  assert.match(openPhotoRoute, /actualHash !== hash/)
  assert.doesNotMatch(openPhotoRoute, /from\(['"]media_objects['"]\)/)
  assert.match(repositoryCheck, /open-photo-transform\.js/)
  assert.match(repositoryCheck, /open-photo-b2\.js/)
})

test('global photo materialization writes immutable hash-addressed objects', async () => {
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  const workflow = await read('.github/workflows/global-photo-enrichment.yml')

  assert.match(materializer, /sha256/i)
  assert.match(materializer, /B2_MEDIA_OPEN_PHOTO_PREFIX/)
  assert.match(workflow, /B2_MEDIA_OPEN_PHOTO_PREFIX/)
  assert.match(workflow, /media\/photos\/by-sha256/)
  assert.match(workflow, /materialize_photo_candidates\.py/)
})

test('private B2 stays behind same-origin open-photo URLs', async () => {
  const nextConfig = await read('next.config.mjs')
  const deliveryUrl = await read('lib/media/open-photo-url.js')
  const openPhotoRoute = await read('app/api/open-photo/[sha256]/route.js')
  const globalDoc = await read('scripts/global-data/index_opensearch.py')

  assert.doesNotMatch(nextConfig, /B2_MEDIA_PUBLIC_BASE_URL|B2_DOWNLOAD_BASE_URL|media\.puddle\.app/)
  assert.match(deliveryUrl, /\/api\/open-photo\//)
  assert.match(openPhotoRoute, /getB2DownloadAuthorization|downloadUrl/)
  assert.match(globalDoc, /primary_photo/)
  assert.doesNotMatch(globalDoc, /primary_photo[^\n]*url/i)
})
