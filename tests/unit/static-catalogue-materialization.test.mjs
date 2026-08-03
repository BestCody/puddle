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

test('discovery serves R2 cards without source-link or catalogue writes', async () => {
  const infrastructure = await read('lib/app/discovery-infrastructure.js')
  assert.equal(infrastructure.includes('upsert_open_catalogue_batch_v1'), false)
  assert.equal(infrastructure.includes(".from('location_source_links')"), false)
  assert.equal(infrastructure.includes('existingStaticSources'), false)
  assert.ok(infrastructure.includes('static_catalogue_ephemeral'))
  assert.ok(infrastructure.includes('static_ref'))
  assert.ok(infrastructure.includes('staticMaterialized: 0'))
})

test('only positive actions and details materialize from signed exact-tile references', async () => {
  const action = await read('app/api/discovery/action/route.js')
  const sharedDeck = await read('app/api/date-match/start/route.js')
  const details = await read('app/api/static-catalogue/open/[id]/route.js')
  const materializer = await read('lib/app/static-catalogue-materialization.js')
  assert.ok(action.includes('MATERIALIZING_ACTIONS'))
  assert.ok(action.includes('materializeStaticCatalogueReferences'))
  assert.ok(action.includes("action_name: action"))
  assert.equal(action.includes('radiusKm'), false)
  assert.ok(sharedDeck.includes('staticRefs'))
  assert.ok(details.includes('staticRef'))
  assert.ok(materializer.includes('fetchStaticPlaceByReference'))
  assert.equal(materializer.includes('fetchNearbyStaticPlaces'), false)
})
