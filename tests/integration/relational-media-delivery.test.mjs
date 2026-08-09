import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { OPEN_PHOTO_SUPABASE_BUCKET, storeOpenPhotoInSupabase } from '../../lib/app/open-photo-supabase.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('relational discovery keeps legacy object-store media off the browser path', async () => {
  const feed = await read('lib/app/discovery-relational.js')
  const card = await read('components/minimal-swipe-card.js')
  const uiKit = await read('components/google-place-photo-fallback.js')
  assert.match(feed, /candidateSources: \['supabase_relational'\]/)
  assert.match(feed, /google_photo_proxy_url: googlePlaceId \? `\/api\/location-google-photo\//)
  assert.match(feed, /google_client_lookup: googleClientLookup/)
  assert.match(feed, /discovery_seen_locations_v1/)
  assert.match(feed, /duplicateKey/)
  assert.doesNotMatch(feed, /static-catalogue|staticCatalogue|Backblaze|b2-private-download|fetchPrivateB2Asset/)
  assert.doesNotMatch(card, /usePrivateB2Asset|useStaticCatalogueDetails|useStaticMediaResolution|\/api\/static-catalogue\//)
  assert.match(uiKit, /gmp-place-details-location-request/)
  assert.match(uiKit, /lookupLocation\(lookup\)/)
  assert.match(uiKit, /mount\.replaceChildren\(\)\n\s+setState\('unavailable'\)/)
})

test('progressive place-photo enrichment targets Supabase and is scheduled to keep the backlog moving', async () => {
  const workflow = await read('.github/workflows/photo-enrichment.yml')
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron: '17 \*\/2 \* \* \*'/)
  assert.match(workflow, /PHOTO_ENRICH_MAX_RUNTIME_MINUTES: '110'/)
  assert.match(workflow, /OPEN_PHOTO_WIKIMEDIA_MAX_CONCURRENCY: '3'/)
  assert.match(workflow, /OPEN_PHOTO_MAPILLARY_MAX_CONCURRENCY: '12'/)
  assert.match(workflow, /Drain prioritized open-photo candidates into Supabase public media/)
  assert.match(workflow, /PHOTO_ENRICH_SYNC_MEDIA: 'false'/)
  assert.doesNotMatch(workflow, /B2_INFRA_ENABLED|B2_S3_ENDPOINT|B2_BUCKET|B2_APPLICATION_KEY/)
})

test('new approved open-photo imports persist directly in Supabase public media', async () => {
  const importer = await read('scripts/import-open-location-photos.mjs')
  const storage = await read('lib/app/open-photo-supabase.js')
  assert.match(importer, /storeOpenPhotoInSupabase/)
  assert.match(importer, /from '\.\.\/lib\/app\/open-photo-supabase\.js'/)
  assert.doesNotMatch(importer, /storeOpenPhotoInR2|open-photo-r2|r2-s3|R2_CONFIG|R2_PUBLIC_BASE_URL/)
  assert.match(storage, /OPEN_PHOTO_SUPABASE_BUCKET = 'puddle-public-media'/)
  assert.match(storage, /admin\.storage\.getBucket/)
  assert.match(storage, /\.jpeg\(\{ quality: 84, mozjpeg: true \}\)/)
  assert.match(storage, /storageBackend: 'supabase'/)
  assert.match(storage, /open-photos\/by-hash/)
  assert.doesNotMatch(storage, /putB2Object|b2Configuration|B2_DOWNLOAD_BASE_URL/)
})

test('Supabase open-photo storage normalizes and uploads a public JPEG', async () => {
  const calls = { getBucket: [], from: [], upload: [] }
  const publicBase = 'https://example.supabase.co/storage/v1/object/public'
  const admin = {
    storage: {
      async getBucket(bucket) {
        calls.getBucket.push(bucket)
        return { data: { id: bucket, public: true }, error: null }
      },
      from(bucket) {
        calls.from.push(bucket)
        return {
          async upload(key, body, options) {
            calls.upload.push({ key, body, options })
            return { data: { path: key }, error: null }
          },
          getPublicUrl(key) {
            return { data: { publicUrl: `${publicBase}/${bucket}/${key}` } }
          }
        }
      }
    }
  }
  const source = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 80, g: 120, b: 160 } }
  }).png().toBuffer()

  const stored = await storeOpenPhotoInSupabase(admin, source)

  assert.deepEqual(calls.getBucket, [OPEN_PHOTO_SUPABASE_BUCKET])
  assert.deepEqual(calls.from, [OPEN_PHOTO_SUPABASE_BUCKET])
  assert.equal(calls.upload.length, 1)
  assert.match(calls.upload[0].key, /^open-photos\/by-hash\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/)
  assert.ok(Buffer.isBuffer(calls.upload[0].body))
  assert.ok(calls.upload[0].body.length > 0)
  assert.deepEqual(calls.upload[0].options, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true
  })
  assert.equal(stored.storageBackend, 'supabase')
  assert.equal(stored.mediaObjectId, null)
  assert.equal(stored.storageKey, calls.upload[0].key)
  assert.equal(stored.remoteUrl, `${publicBase}/${OPEN_PHOTO_SUPABASE_BUCKET}/${stored.storageKey}`)
  assert.match(stored.contentHash, /^[0-9a-f]{64}$/)
  assert.match(stored.perceptualHash, /^[0-9a-f]{16}$/)
  assert.equal(stored.byteSize, calls.upload[0].body.length)
  assert.ok(stored.width > 0)
  assert.ok(stored.height > 0)
})

test('relational open-photo delivery resolves approved provider identity without B2', async () => {
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

test('relational Google delivery uses only the server-side Places credential and exposes UI Kit failover identity', async () => {
  const route = await read('app/api/location-google-photo/[id]/route.js')
  const helper = await read('lib/app/google-place-photo-proxy.js')
  const client = await read('components/google-server-place-photo.js')
  assert.match(route, /location_google_places/)
  assert.match(route, /fetchGooglePlacePhotoById\(mapping\.google_place_id/)
  assert.match(route, /process\.env\.GOOGLE_PLACES_API_KEY/)
  assert.doesNotMatch(route, /process\.env\.GOOGLE_MAPS_API_KEY/)
  assert.doesNotMatch(route, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/)
  assert.match(route, /X-Puddle-Google-Place-Id/)
  assert.match(route, /fallbackHeaders\(fallbackPlaceId\)/)
  assert.doesNotMatch(route, /static_ref|verifyStaticCatalogueReference|fetchPrivateB2Asset/)
  assert.match(helper, /export async function fetchGooglePlacePhotoById/)
  assert.match(helper, /googlePlaceDetails\(placeId/)
  assert.match(client, /x-puddle-google-place-id/)
  assert.match(client, /GooglePlacePhotoFallback/)
  assert.match(client, /uiKitPlaceId/)
})
