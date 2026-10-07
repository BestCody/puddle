import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('discovery fails closed without falling back to a relational catalogue', async () => {
  const [selector, global, route] = await Promise.all([
    read('lib/app/discovery.js'),
    read('lib/app/discovery-global.js'),
    read('app/api/discovery/route.js')
  ])
  assert.match(selector, /getGlobalDiscoveryFeed/)
  assert.doesNotMatch(selector, /global-location-degraded|getRelationalDiscoveryFeed|from\(['"]locations['"]\)/)
  assert.match(global, /searchGlobalLocations/)
  assert.match(route, /getDiscoveryFeed/)
})

test('canonical open photos use same-origin hash URLs and private object-store bytes', async () => {
  const [url, route, store] = await Promise.all([
    read('lib/media/open-photo-url.js'),
    read('app/api/open-photo/[sha256]/route.js'),
    read('lib/storage/self-host-object-store.js')
  ])
  assert.match(url, /normalizeOpenPhotoHash/)
  assert.match(url, /\/api\/open-photo\//)
  assert.match(route, /canonicalStorageKey/)
  assert.match(route, /PUDDLE_OPEN_PHOTO_PREFIX/)
  assert.match(route, /actualHash !== hash/)
  assert.match(route, /downloadSelfHostObject/)
  assert.doesNotMatch(route, /authorizeB2|createAdminClient|from\(['"]media_objects['"]\)/)
  assert.match(store, /new GetObjectCommand/)
  assert.match(store, /byteLimit/)
})

test('photo materialization retains immutable content-addressed keys', async () => {
  const [materializer, index] = await Promise.all([
    read('scripts/global-data/materialize_photo_candidates.py'),
    read('scripts/global-data/build_object_search_index.py')
  ])
  assert.match(materializer, /PUDDLE_OPEN_PHOTO_PREFIX/)
  assert.match(materializer, /sha256/i)
  assert.match(index, /primary_photo/)
  assert.doesNotMatch(index, /primary_photo[^\n]*url/i)
})
