import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { staticCatalogueLocationId, staticMaterializedSlug } from '../../lib/app/static-catalogue-id.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('static catalogue IDs are deterministic UUIDs scoped by source', () => {
  const first = staticCatalogueLocationId('overture', 'place-123')
  const second = staticCatalogueLocationId('overture', 'place-123')
  const otherSource = staticCatalogueLocationId('fsq_os', 'place-123')
  assert.equal(first, second)
  assert.notEqual(first, otherSource)
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('materialized static slugs are stable and collision resistant', () => {
  const id = staticCatalogueLocationId('overture', 'place-123')
  const slug = staticMaterializedSlug({ source: 'overture', sourcePlaceId: 'place-123', name: 'Café & Garden' }, id)
  assert.match(slug, /^cafe-garden-[0-9a-f]{12}$/)
  assert.equal(slug, staticMaterializedSlug({ source: 'overture', sourcePlaceId: 'place-123', name: 'Café & Garden' }, id))
  assert.ok(slug.length <= 100)
})

test('discovery uses R2 first and one relational overlay RPC without source-link writes', async () => {
  const infrastructure = await read('lib/app/discovery-infrastructure.js')
  assert.equal(infrastructure.includes('upsert_open_catalogue_batch_v1'), false)
  assert.equal(infrastructure.includes(".from('location_source_links')"), false)
  assert.ok(infrastructure.includes("supabase.rpc('r2_discovery_overlay_v1'"))
  assert.ok(infrastructure.includes("catalogue: 'r2-primary'"))
  assert.ok(infrastructure.includes('static_catalogue_ephemeral'))
  assert.ok(infrastructure.includes('static_ref'))
  assert.ok(infrastructure.includes('staticMaterialized: 0'))
})

test('positive actions and shared decks batch exact-tile materialization', async () => {
  const action = await read('app/api/discovery/actions/route.js')
  const sharedDeck = await read('app/api/date-match/start/route.js')
  const details = await read('app/api/static-catalogue/open/[id]/route.js')
  const materializer = await read('lib/app/static-catalogue-materialization.js')
  const migration = await read('supabase/migrations/10028_r2_runtime_second_optimization.sql')
  assert.ok(action.includes('MATERIALIZING_ACTIONS'))
  assert.ok(action.includes('materializeStaticCatalogueReferences'))
  assert.ok(action.includes("supabase.rpc('record_discovery_actions_v3'"))
  assert.equal(action.includes('radiusKm'), false)
  assert.ok(sharedDeck.includes('staticRefs'))
  assert.ok(details.includes('staticRef'))
  assert.ok(materializer.includes('fetchStaticPlacesByReferences'))
  assert.ok(materializer.includes("admin.rpc('materialize_static_catalogue_locations_v2'"))
  assert.ok(materializer.includes('validPriceLevel'))
  assert.equal(materializer.includes('fetchNearbyStaticPlaces'), false)
  assert.ok(migration.includes('create or replace function public.materialize_static_catalogue_locations_v2'))
  assert.ok(migration.includes('create or replace function public.record_discovery_actions_v3'))
})
