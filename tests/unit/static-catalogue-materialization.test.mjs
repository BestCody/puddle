import test from 'node:test'
import assert from 'node:assert/strict'
import { staticCatalogueLocationId, staticMaterializedSlug } from '../../lib/app/static-catalogue-materialization.js'

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
