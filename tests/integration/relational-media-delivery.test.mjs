import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Production smoke acceptance requires the relational media routes to be live together.
// Production relational cards must keep browser media delivery off Backblaze.
test('Supabase discovery never sends Backblaze card media into the browser path', async () => {
  const feed = await read('lib/app/discovery-relational-fallback.js')
  assert.match(feed, /function isBackblazeUrl/)
  assert.match(feed, /OPEN_PHOTO_PROVIDERS\.has/)
  assert.match(feed, /\/api\/location-open-photo\//)
  assert.match(feed, /google_photo_proxy_url: googlePlaceId \? `\/api\/location-google-photo\//)
  assert.match(feed, /category_placeholder_url: null/)
  assert.doesNotMatch(feed, /categoryPlaceholderUrl\(/)
})

test('new approved open-photo imports persist in Supabase public media', async () => {
  const importer = await read('scripts/import-open-location-photos.mjs')
  const compatibility = await read('lib/app/open-photo-r2.js')
  const storage = await read('lib/app/open-photo-supabase.js')
  assert.match(importer, /storeOpenPhotoInR2/)
  assert.match(compatibility, /storeOpenPhotoInSupabase as storeOpenPhotoInR2/)
  assert.match(storage, /OPEN_PHOTO_SUPABASE_BUCKET = 'puddle-public-media'/)
  assert.match(storage, /admin\.storage\.getBucket/)
  assert.match(storage, /\.jpeg\(\{ quality: 84, mozjpeg: true \}\)/)
  assert.match(storage, /storageBackend: 'supabase'/)
  assert.match(storage, /open-photos\/by-hash/)
  assert.doesNotMatch(storage, /putB2Object|b2Configuration|B2_DOWNLOAD_BASE_URL/)
})

test('relational open-photo delivery resolves the persisted approved identity without B2', async () => {
  const route = await read('app/api/location-open-photo/[id]/route.js')
  const approved = await read('lib/app/approved-open-photo.js')
  assert.match(route, /findApprovedOpenPhotoCandidate/)
  assert.match(route, /downloadStaticOpenPhotoCandidate/)
  assert.match(route, /external_photo_id/)
  assert.match(route, /Content-Type': 'image\/jpeg'/)
  assert.match(approved, /graph\.mapillary\.com\/\$\{encodeURIComponent\(id\)\}/)
  assert.match(approved, /thumb_2048_url/)
  assert.match(approved, /String\(row\?\.id \|\| ''\) !== id/)
  assert.doesNotMatch(route, /b2-private-download|fetchPrivateB2Asset|authorizeB2DownloadUrl/)
  assert.doesNotMatch(approved, /b2-private-download|fetchPrivateB2Asset|authorizeB2DownloadUrl/)
})

test('relational Google delivery uses the verified Place ID and production key aliases', async () => {
  const route = await read('app/api/location-google-photo/[id]/route.js')
  const helper = await read('lib/app/google-place-photo-proxy.js')
  assert.match(route, /location_google_places/)
  assert.match(route, /fetchGooglePlacePhotoById\(mapping\.google_place_id/)
  assert.match(route, /consume_static_google_runtime_budget_v1/)
  assert.match(route, /process\.env\.GOOGLE_PLACES_API_KEY/)
  assert.match(route, /process\.env\.GOOGLE_MAPS_API_KEY/)
  assert.match(route, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/)
  assert.doesNotMatch(route, /static_ref|verifyStaticCatalogueReference|fetchPrivateB2Asset/)
  assert.match(helper, /export async function fetchGooglePlacePhotoById/)
  assert.match(helper, /googlePlaceDetails\(placeId/)
})
