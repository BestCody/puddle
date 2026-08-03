import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { staticCatalogueLocationId, staticMaterializedSlug } from '../../lib/app/static-catalogue-materialization.js'

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

test('discovery serves R2 cards without catalogue writes', async () => {
  const infrastructure = await read('lib/app/discovery-infrastructure.js')
  assert.equal(infrastructure.includes('upsert_open_catalogue_batch_v1'), false)
  assert.ok(infrastructure.includes('static_catalogue_ephemeral'))
  assert.ok(infrastructure.includes('staticMaterialized: 0'))
  assert.ok(infrastructure.includes('logInfrastructureDiscoveryImpressions'))
})

test('meaningful actions materialize only the selected static locations', async () => {
  const action = await read('app/api/discovery/action/route.js')
  const sharedDeck = await read('app/api/date-match/start/route.js')
  const details = await read('app/api/static-catalogue/open/[id]/route.js')
  const migration = await read('supabase/migrations/10025_static_catalogue_on_demand.sql')
  assert.ok(action.includes('materializeStaticCatalogueLocations'))
  assert.ok(sharedDeck.includes('materializeStaticCatalogueLocations'))
  assert.ok(details.includes('materializeStaticCatalogueLocations'))
  assert.ok(migration.includes('materialize_static_catalogue_location_v1'))
  assert.ok(migration.includes('grant execute on function public.materialize_static_catalogue_location_v1'))
})
