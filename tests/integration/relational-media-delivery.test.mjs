import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Supabase discovery never sends Backblaze card media into the browser path', async () => {
  const feed = await read('lib/app/discovery-relational-fallback.js')
  assert.match(feed, /function isBackblazeUrl/)
  assert.match(feed, /OPEN_PHOTO_PROVIDERS\.has/)
  assert.match(feed, /\/api\/location-open-photo\//)
  assert.match(feed, /google_photo_proxy_url: googlePlaceId \? `\/api\/location-google-photo\//)
  assert.match(feed, /category_placeholder_url: null/)
  assert.doesNotMatch(feed, /categoryPlaceholderUrl\(/)
})

test('relational open-photo delivery re-fetches the approved provider asset without B2', async () => {
  const route = await read('app/api/location-open-photo/[id]/route.js')
  assert.match(route, /findStaticOpenPhotoCandidates/)
  assert.match(route, /downloadStaticOpenPhotoCandidate/)
  assert.match(route, /external_photo_id/)
  assert.match(route, /entry\.externalId/)
  assert.match(route, /Content-Type': 'image\/jpeg'/)
  assert.doesNotMatch(route, /b2-private-download|fetchPrivateB2Asset|authorizeB2DownloadUrl/)
})

test('relational Google delivery uses the verified Place ID without a static catalogue reference', async () => {
  const route = await read('app/api/location-google-photo/[id]/route.js')
  const helper = await read('lib/app/google-place-photo-proxy.js')
  assert.match(route, /location_google_places/)
  assert.match(route, /fetchGooglePlacePhotoById\(mapping\.google_place_id/)
  assert.match(route, /consume_static_google_runtime_budget_v1/)
  assert.doesNotMatch(route, /static_ref|verifyStaticCatalogueReference|fetchPrivateB2Asset/)
  assert.match(helper, /export async function fetchGooglePlacePhotoById/)
  assert.match(helper, /googlePlaceDetails\(placeId/)
})
