import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { signStaticCatalogueReference, verifyStaticCatalogueReference } from '../../lib/app/static-catalogue-ref.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
async function missing(path) {
  try {
    await access(new URL(`../../${path}`, import.meta.url))
    return false
  } catch {
    return true
  }
}

test('static references are tile-specific, expiring, and tamper evident', () => {
  const secret = 'a'.repeat(64)
  const now = Date.UTC(2026, 7, 3)
  const token = signStaticCatalogueReference({
    contentId: 'df5c34ae-b8bb-5eca-b251-7d0b6ed90ae3',
    source: 'overture',
    sourcePlaceId: 'abc',
    tile: { z: 10, x: 100, y: 200 }
  }, { release: 'r1' }, { secret, now, ttlSeconds: 600 })
  const verified = verifyStaticCatalogueReference(token, {
    secret,
    now,
    expectedId: 'df5c34ae-b8bb-5eca-b251-7d0b6ed90ae3'
  })
  assert.deepEqual(verified.tile, { z: 10, x: 100, y: 200 })
  assert.equal(verified.release, 'r1')
  assert.throws(() => verifyStaticCatalogueReference(`${token}x`, { secret, now }), /invalid|signature/)
  assert.throws(() => verifyStaticCatalogueReference(token, { secret, now: now + 601_000 }), /expired/)
})

test('the runtime uses only the ordered batched action endpoint', async () => {
  const batchAction = await read('app/api/discovery/actions/route.js')
  const fastPath = await read('supabase/migrations/10031_discovery_actions_v4.sql')
  const client = await read('components/date-swipe-workspace-v2.js')
  assert.ok(await missing('app/api/discovery/action/route.js'))
  assert.ok(batchAction.includes("supabase.rpc('record_discovery_actions_v4'"))
  assert.ok(fastPath.includes('return public.record_discovery_actions_v3(actions)'))
  assert.ok(batchAction.includes('MAX_ACTIONS = 20'))
  assert.equal(batchAction.includes('radiusKm'), false)
  assert.ok(client.includes("csrfFetch('/api/discovery/actions'"))
  assert.ok(client.includes('ACTION_BATCH_DELAY_MS'))
  assert.ok(client.includes('ACTION_BATCH_SIZE = 20'))
  assert.ok(client.includes('keepalive'))
  assert.ok(client.includes('staticCatalogueEphemeral'))
  assert.ok(client.includes('staticRef'))
})

test('catalogue build uses schema-v3 compact filters and separate provenance shards', async () => {
  const build = await read('scripts/build-static-location-catalogue.mjs')
  const catalogue = await read('lib/app/static-catalogue.js')
  const discovery = await read('lib/app/discovery-infrastructure.js')
  assert.ok(build.includes("'provenance'"))
  assert.ok(build.includes('packStaticProvenance'))
  assert.ok(catalogue.includes('openingHoursCompact'))
  assert.ok(catalogue.includes('accessibilityBits'))
  assert.ok(catalogue.includes('STATIC_CATALOGUE_TILE_CONCURRENCY'))
  assert.ok(catalogue.includes('fetchStaticPlacesByReferences'))
  assert.ok(discovery.includes('media.photoUrl'))
  assert.ok(discovery.includes('media.googlePlaceId'))
  assert.equal(discovery.includes('getDiscoveryFeed'), false)
  assert.equal(discovery.includes('supabase-fallback'), false)
  assert.equal(discovery.includes('logInfrastructureDiscoveryImpressions'), false)
  assert.ok(await missing('lib/app/discovery.js'))
})

test('historical R2-named migration owns independent v3 actions and dry-run cleanup', async () => {
  const migration = await read('supabase/migrations/10028_r2_runtime_second_optimization.sql')
  assert.ok(await missing('supabase/migrations/10029_r2_cleanup_batch_preview.sql'))
  for (const marker of [
    'drop column if exists source',
    'create table if not exists public.discovery_session_samples',
    'r2_discovery_overlay_v1',
    'record_discovery_session_sample_v1',
    'materialize_static_catalogue_locations_v2',
    'record_discovery_actions_v3',
    'discovery_action_receipts',
    'prepare_r2_cleanup_v2',
    'apply_changes boolean default false',
    'delete_unreferenced_media_objects_v1',
    'drop function if exists public.record_discovery_action_v2'
  ]) assert.ok(migration.includes(marker), `permanent optimization migration is missing ${marker}`)
  assert.equal(migration.includes("perform public.record_discovery_action_v2"), false)
})

test('B2 overlay writes and cleanup use serialized jobs and a required registry', async () => {
  const overlay = await read('lib/app/static-media-overlay.js')
  const publisher = await read('scripts/publish-static-catalogue-b2.mjs')
  const cleanup = await read('scripts/cleanup-b2-assets.mjs')
  const photoWorkflow = await read('.github/workflows/photo-enrichment.yml')
  const cleanupWorkflow = await read('.github/workflows/b2-cleanup.yml')
  assert.ok(overlay.includes('b2Request'))
  assert.equal(overlay.includes("'if-match'"), false)
  assert.equal(overlay.includes("'if-none-match'"), false)
  assert.ok(publisher.includes('release-registry.json'))
  assert.ok(publisher.includes('updateReleaseRegistry'))
  assert.equal(publisher.includes("'if-match'"), false)
  assert.ok(cleanup.includes("admin.rpc('prepare_r2_cleanup_v2'"))
  assert.ok(cleanup.includes('release-registry.json is required'))
  assert.equal(cleanup.includes("allObjects('catalogue/releases/')"), false)
  assert.ok(photoWorkflow.includes('cancel-in-progress: false'))
  assert.ok(cleanupWorkflow.includes('cancel-in-progress: false'))
})

test('legacy executable product surfaces are absent', async () => {
  for (const path of [
    'lib/product-vision.js', 'app/events', 'app/friends', 'app/inbox',
    'app/api/stripe', 'app/api/tickets', 'app/api/location-sharing',
    'lib/stripe', 'lib/tickets', 'components/event-editor.js'
  ]) assert.ok(await missing(path), `${path} should be removed`)
})
