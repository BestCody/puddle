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

test('the optimized runtime avoids pass materialization, radius rescans, and multi-RPC writes', async () => {
  const action = await read('app/api/discovery/action/route.js')
  const client = await read('components/date-swipe-workspace-v2.js')
  assert.ok(action.includes("const MATERIALIZING_ACTIONS = new Set(['saved', 'interested', 'visited', 'opened', 'perfect'])"))
  assert.ok(action.includes("supabase.rpc('record_discovery_action_v2'"))
  assert.equal(action.includes("record_discovery_action_v1"), false)
  assert.equal(action.includes('radiusKm'), false)
  assert.ok(client.includes('setIndex((currentIndex) => currentIndex + 1)'))
  assert.ok(client.includes('staticCatalogueEphemeral'))
  assert.ok(client.includes('staticRef'))
  assert.ok(client.includes('const actionQueue = useRef(Promise.resolve())'))
})

test('catalogue build splits deck and detail data and discovery consumes the media overlay', async () => {
  const build = await read('scripts/build-static-location-catalogue.mjs')
  const catalogue = await read('lib/app/static-catalogue.js')
  const discovery = await read('lib/app/discovery-infrastructure.js')
  assert.ok(build.includes("'details'"))
  assert.ok(build.includes('packStaticDetail'))
  assert.ok(catalogue.includes('mediaOverlayObjectKey'))
  assert.ok(catalogue.includes('DETAIL_FIELDS'))
  assert.ok(discovery.includes('media.photoUrl'))
  assert.ok(discovery.includes('media.googlePlaceId'))
})

test('database migration stores compact actions, shared media, retention, and Google retry state', async () => {
  const migration = await read('supabase/migrations/10026_r2_runtime_optimizations.sql')
  for (const marker of [
    'create table if not exists public.media_objects',
    'create table if not exists public.static_catalogue_actions',
    'create table if not exists public.static_catalogue_materializations',
    'create table if not exists public.google_place_match_attempts',
    'record_discovery_action_v2',
    'claim_google_place_candidates_v1',
    'delete_cold_static_materialization_v1',
    "expires_at timestamptz not null default (now()+interval '90 days')"
  ]) assert.ok(migration.includes(marker), `optimization migration is missing ${marker}`)
  assert.equal(migration.includes('return public.upsert_open_catalogue_location_v1'), false)
})

test('workers update overlays and remember Google no-match outcomes', async () => {
  const photoRunner = await read('scripts/enrich-open-location-photos.mjs')
  const google = await read('scripts/match-google-places.mjs')
  const overlay = await read('lib/app/static-media-overlay.js')
  assert.ok(photoRunner.includes('sync-static-media-overlays.mjs'))
  assert.ok(google.includes('google_place_match_attempts'))
  assert.ok(google.includes('claim_google_place_candidates_v1'))
  assert.ok(google.includes('syncStaticMediaOverlayForLocations'))
  assert.ok(overlay.includes('mediaOverlayObjectKey'))
})
