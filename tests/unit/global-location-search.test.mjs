import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGlobalLocationSearchBody, globalLocationSearchConfig, isGlobalLocationSearchConfigured } from '../../lib/app/global-location-search.js'

test('global search builds geo, hard-filter, text, and exclusion clauses', () => {
  const body = buildGlobalLocationSearchBody({
    latitude: 43.6532, longitude: -79.3832, distanceKm: 25,
    filters: { q: 'coffee', category: 'cafe', price: '2', amenity: 'wifi', accessible: true },
    excludeIds: ['11111111-1111-4111-8111-111111111111'], preferredCategories: ['cafe'], candidateLimit: 750
  })
  assert.equal(body.size, 750)
  const bool = body.query.function_score.query.bool
  assert.ok(bool.filter.some((entry) => entry.geo_distance))
  assert.ok(bool.filter.some((entry) => entry.term?.category === 'cafe'))
  assert.ok(bool.must.some((entry) => entry.multi_match?.query === 'coffee'))
  assert.deepEqual(bool.must_not[0].terms.id, ['11111111-1111-4111-8111-111111111111'])
})

test('global serving only activates with both flag and endpoint', () => {
  const env = { GLOBAL_LOCATION_SEARCH_ENABLED: 'true', GLOBAL_LOCATION_SEARCH_URL: 'https://search.example.com', GLOBAL_LOCATION_SEARCH_INDEX: 'locations-active' }
  assert.equal(isGlobalLocationSearchConfigured(env), true)
  assert.equal(isGlobalLocationSearchConfigured(env), true)
  assert.equal(isGlobalLocationSearchConfigured({ ...env, GLOBAL_LOCATION_SEARCH_URL: '' }), false)
  assert.equal(globalLocationSearchConfig(env).candidateLimit, 500)
})
