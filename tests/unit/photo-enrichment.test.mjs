import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  boundedInteger,
  claimBatchSizes,
  isStatementTimeout,
  parsePhotoImportSummary,
  photoDisplayState,
  retryAfterMilliseconds,
  retryDelayMilliseconds,
  shouldContinuePhotoEnrichment,
  validatePhotoImportSummary
} from '../../lib/app/photo-enrichment.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('bounds progressive photo worker configuration', () => {
  assert.equal(boundedInteger('500', 200, { min: 1, max: 5_000 }), 500)
  assert.equal(boundedInteger('not-a-number', 500, { min: 1, max: 5_000 }), 500)
  assert.equal(boundedInteger('-10', 500, { min: 1, max: 5_000 }), 1)
  assert.equal(boundedInteger('9000', 500, { min: 1, max: 5_000 }), 5_000)
})

test('parses and validates noisy importer summaries', () => {
  const output = `provider warning\n${JSON.stringify({ inspected: 3, claimLimit: 3, matched: 1, imported: 1, noMatch: 1, failed: 1, skipped: 0 }, null, 2)}\n`
  const summary = validatePhotoImportSummary(parsePhotoImportSummary(output))
  assert.equal(summary.inspected, 3)
  assert.equal(summary.imported, 1)
  assert.equal(summary.claimLimit, 3)
  assert.equal(shouldContinuePhotoEnrichment(summary, 3), true)
  assert.equal(shouldContinuePhotoEnrichment({ ...summary, inspected: 2 }, 3), false)
  assert.equal(shouldContinuePhotoEnrichment({ ...summary, inspected: 2, claimLimit: 2 }, 3), true)
  assert.throws(
    () => validatePhotoImportSummary({ inspected: 3, matched: 1, imported: 1, noMatch: 0, failed: 0, skipped: 0 }),
    /settled 1 of 3/
  )
})

test('backs off statement timeouts and provider throttling deterministically', () => {
  assert.deepEqual(claimBatchSizes(100), [100, 50, 25, 12, 6, 3, 1])
  assert.deepEqual(claimBatchSizes(3, { min: 2 }), [3, 2])
  assert.equal(isStatementTimeout({ code: '57014' }), true)
  assert.equal(isStatementTimeout(new Error('canceling statement due to statement timeout')), true)
  assert.equal(isStatementTimeout(new Error('other failure')), false)
  assert.equal(retryAfterMilliseconds('2'), 2_000)
  assert.equal(retryAfterMilliseconds(new Date(15_000).toUTCString(), 10_000), 5_000)
  assert.equal(retryDelayMilliseconds({ attempt: 2, baseMs: 1_000 }), 4_000)
  assert.equal(retryDelayMilliseconds({ attempt: 1, retryAfterMs: 9_000, baseMs: 1_000 }), 9_000)
})

test('only a genuine no-match receives the permanent placeholder state', () => {
  assert.equal(photoDisplayState('matched', true), 'photo')
  assert.equal(photoDisplayState('pending', false), 'searching')
  assert.equal(photoDisplayState('processing', false), 'searching')
  assert.equal(photoDisplayState('failed', false), 'retrying')
  assert.equal(photoDisplayState('no_match', false), 'unavailable')
})

test('photo claims keep priority while bounding work and recovering transient failures', async () => {
  const migration = await read('supabase/migrations/10023_photo_pipeline_hardening.sql')
  for (const marker of [
    "array['image/jpeg','image/png','image/webp','image/avif']",
    'locations_open_photo_queue_idx',
    'recent_deck_rows as materialized',
    'limit 10000',
    'fallback_pool as materialized',
    'active_profiles_ranked as materialized',
    'limit 250',
    'for update of location skip locked',
    "photo_enrichment_status='pending'"
  ]) assert.ok(migration.includes(marker), `photo hardening migration is missing ${marker}`)
  assert.ok(migration.indexOf('deck.id,deck.priority') < migration.indexOf('case when nearby.last_active is null then 2 else 1 end'))
})

test('the importer throttles providers, reduces timed-out claims, and tries alternate assets', async () => {
  const importer = await read('scripts/import-open-location-photos.mjs')
  for (const marker of [
    'WIKIMEDIA_MIN_INTERVAL_MS',
    "response.headers.get('retry-after')",
    'MAX_CANDIDATES_PER_PROVIDER',
    'claimBatchSizes(LIMIT',
    'isStatementTimeout(result.error)',
    'trying the next candidate',
    'createProviderRequestLimiter',
    'KARTAVIEW_ACCESS_TOKEN',
    'OPEN_PHOTO_LOCATION_CONCURRENCY'
  ]) assert.ok(importer.includes(marker), `photo importer is missing ${marker}`)
  assert.equal(importer.includes('&quot;'), false)
})

test('Geoapify detection requires a hostname boundary', async () => {
  const geocoding = await read('lib/app/geocoding.js')
  assert.ok(geocoding.includes("url.hostname === 'geoapify.com'"))
  assert.ok(geocoding.includes("url.hostname.endsWith('.geoapify.com')"))
  assert.equal(geocoding.includes("url.hostname.endsWith('geoapify.com')"), false)
})

test('the active relational card uses Google server photos and UI Kit fallback without private object-store grants', async () => {
  const card = await read('components/minimal-swipe-card.js')
  const googleServerPhoto = await read('components/google-server-place-photo.js')
  const googleFallback = await read('components/google-place-photo-fallback.js')
  assert.ok(card.includes('GoogleServerPlacePhoto'))
  assert.ok(card.includes('GooglePlacePhotoFallback'))
  assert.ok(card.includes('item.google_photo_proxy_url'))
  assert.ok(card.includes('!mainPhoto && Boolean(googleServerPhotoUrl)'))
  assert.ok(card.includes('!useGoogleServerPhoto && !mainPhoto && Boolean(googleLookup)'))
  assert.equal(card.includes('usePrivateB2Asset'), false)
  assert.equal(card.includes('/api/static-catalogue/'), false)
  assert.equal(card.includes('static_ref'), false)
  assert.ok(googleServerPhoto.includes("fetch(url, { cache: 'no-store', credentials: 'same-origin' })"))
  assert.ok(googleServerPhoto.includes('URL.createObjectURL'))
  assert.ok(googleFallback.includes("window.google.maps.importLibrary('places')"))
  assert.ok(googleFallback.includes("document.createElement('gmp-place-details-compact')"))
  assert.ok(googleFallback.includes("mount.replaceChildren()\n      setState('unavailable')"))
  assert.equal(googleFallback.includes('/api/location-google-place/'), false)
  assert.equal(googleFallback.includes('photoUri'), false)
  assert.equal(googleFallback.includes('photos.googleapis.com'), false)
  assert.ok(card.includes('/api/location-photo-status/'))
  assert.ok(card.includes("displayState === 'unavailable'"))
  assert.ok(card.includes('Wikimedia Commons, Mapillary, and KartaView'))
})

test('transition photo enrichment writes B2 media and uses the full configured provider entitlement', async () => {
  const photoWorkflow = await read('.github/workflows/photo-enrichment.yml')
  const packageJson = JSON.parse(await read('package.json'))
  assert.ok(photoWorkflow.includes("PHOTO_ENRICH_BATCH_SIZE: '100'"))
  assert.ok(photoWorkflow.includes("PHOTO_ENRICH_MAX_BATCHES: '200'"))
  assert.ok(photoWorkflow.includes("PHOTO_ENRICH_MAX_RUNTIME_MINUTES: '110'"))
  assert.ok(photoWorkflow.includes('workflow_dispatch:'))
  assert.ok(photoWorkflow.includes('schedule:'))
  assert.ok(photoWorkflow.includes("cron: '17 * * * *'"))
  assert.ok(photoWorkflow.includes('B2_MEDIA_ENABLED'))
  assert.ok(photoWorkflow.includes('B2_MEDIA_APPLICATION_KEY_ID'))
  assert.ok(photoWorkflow.includes('B2_MEDIA_APPLICATION_KEY'))
  assert.ok(photoWorkflow.includes('npm run locations:photos:enrich'))
  assert.ok(photoWorkflow.includes("PHOTO_ENRICH_SYNC_MEDIA: 'false'"))
  assert.ok(photoWorkflow.includes("OPEN_PHOTO_WIKIMEDIA_MIN_INTERVAL_MS: '300'"))
  assert.ok(photoWorkflow.includes("OPEN_PHOTO_WIKIMEDIA_MAX_CONCURRENCY: '3'"))
  assert.ok(photoWorkflow.includes("OPEN_PHOTO_MAPILLARY_MAX_CONCURRENCY: '32'"))
  assert.ok(photoWorkflow.includes("OPEN_PHOTO_KARTAVIEW_MIN_INTERVAL_MS: '3600'"))
  assert.ok(photoWorkflow.includes("OPEN_PHOTO_LOCATION_CONCURRENCY: '100'"))
  assert.ok(photoWorkflow.includes('KARTAVIEW_ACCESS_TOKEN'))
  assert.equal(photoWorkflow.includes('B2_INFRA_ENABLED'), false)
  assert.equal(photoWorkflow.includes('B2_S3_ENDPOINT'), false)
  assert.equal(photoWorkflow.includes('PHOTO_ENRICH_MIGRATOR'), false)
  assert.equal(packageJson.scripts['locations:photos:migrate-r2'], undefined)
  assert.equal(packageJson.scripts['locations:catalogue:open'], undefined)
  assert.equal(packageJson.scripts['locations:catalogue:refresh'], undefined)
  assert.equal(packageJson.scripts['locations:photos:migrate-b2'], 'node scripts/migrate-open-photos-to-b2.mjs')
})
