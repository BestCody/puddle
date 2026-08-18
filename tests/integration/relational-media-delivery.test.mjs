import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { transformOpenPhoto } from '../../lib/app/open-photo-transform.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('discovery has a global-serving seam and uses Supabase only when global serving is deliberately disabled', async () => {
  const selector = await read('lib/app/discovery.js')
  const global = await read('lib/app/discovery-global.js')
  const relational = await read('lib/app/discovery-relational.js')
  const route = await read('app/api/discovery/route.js')

  assert.match(selector, /getGlobalDiscoveryFeed/)
  assert.match(selector, /GLOBAL_LOCATION_SEARCH_ENABLED/)
  assert.match(selector, /if \(!useGlobalLocationServing\(\)\) return getRelationalDiscoveryFeed\(session, filters, options\)/)
  assert.equal(selector.match(/getRelationalDiscoveryFeed\(session, filters, options\)/g)?.length, 1)
  assert.doesNotMatch(selector, /GLOBAL_LOCATION_FALLBACK_TO_SUPABASE/)
  assert.doesNotMatch(selector, /relational-discovery-fallback/)
  assert.match(global, /global-location-serving/)
  assert.match(global, /searchGlobalLocations/)
  assert.match(route, /getDiscoveryFeed/)
  assert.doesNotMatch(route, /getRelationalDiscoveryFeed/)
  assert.match(relational, /r2_discovery_overlay_v2/)
})

test('new approved open-photo writes are B2-only after the one-off Supabase migration is retired', async () => {
  const importer = await read('scripts/import-open-location-photos.mjs')
  const b2 = await read('lib/app/open-photo-b2.js')
  const deliveryUrl = await read('lib/media/open-photo-url.js')
  const packageJson = JSON.parse(await read('package.json'))
  const repositoryCheck = await read('scripts/check.mjs')

  assert.match(importer, /storeOpenPhotoInB2/)
  assert.doesNotMatch(importer, /storeOpenPhotoInSupabase|open-photo-supabase/)
  assert.match(b2, /storageBackend: 'b2'/)
  assert.match(b2, /media\/photos\/by-sha256/)
  assert.match(b2, /\.from\('media_objects'\)/)
  assert.match(b2, /mediaObjectId: mediaObject\.id/)
  assert.match(deliveryUrl, /normalizeOpenPhotoHash/)
  assert.match(deliveryUrl, /\/api\/open-photo\//)
  assert.equal(packageJson.scripts['locations:photos:migrate-b2'], undefined)
  assert.match(repositoryCheck, /scripts\/migrate-open-photos-to-b2\.mjs/)
  assert.match(repositoryCheck, /\.github\/workflows\/migrate-open-photos-b2\.yml/)
})

test('storage-neutral open-photo transform produces immutable JPEG identity metadata', async () => {
  const source = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 80, g: 120, b: 160 } }
  }).png().toBuffer()
  const transformed = await transformOpenPhoto(source)

  assert.ok(Buffer.isBuffer(transformed.body))
  assert.ok(transformed.body.length > 0)
  assert.match(transformed.contentHash, /^[0-9a-f]{64}$/)
  assert.match(transformed.perceptualHash, /^[0-9a-f]{16}$/)
  assert.equal(transformed.byteSize, transformed.body.length)
  assert.ok(transformed.width > 0)
  assert.ok(transformed.height > 0)
})

test('global media delivery accepts transition B2 origin and keeps Google photo bytes transient', async () => {
  const nextConfig = await read('next.config.mjs')
  const photoHelper = await read('lib/app/google-place-photo-proxy.js')
  const googleRoute = await read('app/api/location-google-photo/[id]/route.js')
  const globalDoc = await read('scripts/global-data/index_opensearch.py')

  assert.match(nextConfig, /B2_MEDIA_PUBLIC_BASE_URL/)
  assert.match(nextConfig, /B2_DOWNLOAD_BASE_URL/)
  assert.match(nextConfig, /media\.puddle\.app/)
  assert.match(globalDoc, /primary_photo/)
  assert.match(globalDoc, /DATA_PREFIX/)
  assert.match(googleRoute, /Cache-Control': 'private, no-store/)
  assert.match(photoHelper, /fetchGooglePlacePhotoById/)
  assert.doesNotMatch(globalDoc, /Google Place Photos|\/photos\/.*media/)
})
