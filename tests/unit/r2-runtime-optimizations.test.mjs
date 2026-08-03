import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { signStaticCatalogueReference, verifyStaticCatalogueReference } from '../../lib/app/static-catalogue-ref.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('static references are tile-specific, expiring, and tamper evident', () => {
  const secret = 'a'.repeat(64)
  const now = Date.UTC(2026, 7, 3)
  const token = signStaticCatalogueReference({
    contentId: 'df5c34ae-b8bb-5eca-b251-7d0b6ed90ae3', source: 'overture', sourcePlaceId: 'abc',
    tile: { z: 10, x: 100, y: 200 }
  }, { release: 'r1' }, { secret, now, ttlSeconds: 600 })
  const verified = verifyStaticCatalogueReference(token, { secret, now, expectedId: 'df5c34ae-b8bb-5eca-b251-7d0b6ed90ae3' })
  assert.deepEqual(verified.tile, { z: 10, x: 100, y: 200 })
  assert.equal(verified.release, 'r1')
  assert.throws(() => verifyStaticCatalogueReference(`${token}x`, { secret, now }), /invalid|signature/)
  assert.throws(() => verifyStaticCatalogueReference(token, { secret, now: now + 601_000 }), /expired/)
})

test('the optimized runtime batches optimistic actions and keeps pass-only cards ephemeral', async () => {
  const singleAction = await read('app/api/discovery/action/route.js')
  const batchAction = await read('app/api/discovery/actions/route.js')
  const client = await read('components/date-swipe-workspace-v2.js')
  assert.ok(singleAction.includes("const MATERIALIZING_ACTIONS = new Set(['saved', 'interested', 'visited', 'opened', 'perfect'])"))
  assert.ok(batchAction.includes("supabase.rpc('record_discovery_actions_v3'"))
  assert.ok(batchAction.includes('MAX_ACTIONS = 20'))
  assert.equal(batchAction.includes('radiusKm'), false)
  assert.ok(client.includes("csrfFetch('/api/discovery/actions'"))
  assert.ok(client.includes('ACTION_BATCH_DELAY_MS'))
  assert.ok(client.includes('ACTION_BATCH_SIZE = 20'))
  assert.ok(client.includes('keepalive'))
  assert.ok(client.includes('setIndex((currentIndex) => currentIndex + 1)'))
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
  assert.equal(discovery.includes('includeDetails = Boolean'), false)
})

test('second-pass migrations add one overlay RPC, compact actions, sampled analytics, and batched cleanup', async () => {
  const migration = await read('supabase/migrations/10028_r2_runtime_second_optimization.sql')
  const cleanup = await read('supabase/migrations/10029_r2_cleanup_batch_preview.sql')
  for (const marker of [
    'drop column if exists source',
    'create table if not exists public.discovery_session_samples',
    'r2_discovery_overlay_v1',
    'record_discovery_session_sample_v1',
    'materialize_static_catalogue_locations_v2',
    'record_discovery_actions_v3',
    'prepare_r2_cleanup_v1',
    'delete_unreferenced_media_objects_v1'
  ]) assert.ok(migration.includes(marker), `second optimization migration is missing ${marker}`)
  assert.ok(cleanup.includes('prepare_r2_cleanup_v2'))
  assert.ok(cleanup.includes('apply_changes boolean default false'))
})

test('overlay writes and release publishing use conditional concurrency control', async () => {
  const overlay = await read('lib/app/static-media-overlay.js')
  const publisher = await read('scripts/publish-static-catalogue-r2.mjs')
  const cleanup = await read('scripts/cleanup-r2-assets.mjs')
  assert.ok(overlay.includes("'if-match'"))
  assert.ok(overlay.includes("'if-none-match'"))
  assert.ok(overlay.includes('response.status === 412'))
  assert.ok(publisher.includes('release-registry.json'))
  assert.ok(publisher.includes('updateReleaseRegistry'))
  assert.ok(cleanup.includes("admin.rpc('prepare_r2_cleanup_v2'"))
  assert.ok(cleanup.includes('runPool'))
})
