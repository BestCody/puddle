import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGlobalLocationSearchBody,
  buildGlobalLocationViewportSearchBody,
  globalLocationSearchConfig,
  isGlobalLocationSearchConfigured,
  normalizeGlobalLocationViewport,
  searchGlobalLocationsInViewport,
  viewportLocationLimit
} from '../../lib/app/global-location-search.js'

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

test('map viewport search uses an OpenSearch geo bounding box and zoom-aware cap', () => {
  const body = buildGlobalLocationViewportSearchBody({
    north: 43.80,
    south: 43.55,
    west: -79.65,
    east: -79.10,
    zoom: 13
  })
  assert.equal(body.size, 150)
  const bool = body.query.function_score.query.bool
  const geo = bool.filter.find((entry) => entry.geo_bounding_box)
  assert.deepEqual(geo.geo_bounding_box.location.top_left, { lat: 43.8, lon: -79.65 })
  assert.deepEqual(geo.geo_bounding_box.location.bottom_right, { lat: 43.55, lon: -79.1 })
  assert.ok(bool.filter.some((entry) => entry.term?.status === 'published'))
  assert.equal(body.track_total_hits, false)
})

test('map viewport request sends configured Basic auth to locations-active', async () => {
  const env = {
    GLOBAL_LOCATION_SEARCH_URL: 'https://search.example.com',
    GLOBAL_LOCATION_SEARCH_INDEX: 'locations-active',
    OPENSEARCH_USERNAME: 'puddle-indexer',
    OPENSEARCH_PASSWORD: 'secret-value'
  }
  let request
  const fetchFn = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      took: 7,
      timed_out: false,
      hits: {
        hits: [{
          _id: 'location-1',
          _score: 10,
          _source: {
            id: 'location-1',
            slug: 'test-place',
            name: 'Test Place',
            status: 'published',
            latitude: 43.6532,
            longitude: -79.3832
          }
        }]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const result = await searchGlobalLocationsInViewport({
    north: 43.8,
    south: 43.5,
    west: -79.7,
    east: -79.1,
    zoom: 13
  }, { env, fetchFn })

  assert.equal(request.url, 'https://search.example.com/locations-active/_search')
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from('puddle-indexer:secret-value').toString('base64')}`)
  assert.equal(request.options.method, 'POST')
  assert.equal(result.timedOut, false)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].slug, 'test-place')
})

test('map viewport search splits a date-line crossing into two bounding boxes', () => {
  const body = buildGlobalLocationViewportSearchBody({
    north: 20,
    south: -20,
    west: 170,
    east: -170,
    zoom: 7
  })
  const geo = body.query.function_score.query.bool.filter[0]
  assert.equal(geo.bool.minimum_should_match, 1)
  assert.equal(geo.bool.should.length, 2)
  assert.equal(geo.bool.should[0].geo_bounding_box.location.top_left.lon, 170)
  assert.equal(geo.bool.should[0].geo_bounding_box.location.bottom_right.lon, 180)
  assert.equal(geo.bool.should[1].geo_bounding_box.location.top_left.lon, -180)
  assert.equal(geo.bool.should[1].geo_bounding_box.location.bottom_right.lon, -170)
})

test('map viewport validation and result caps stay bounded', () => {
  assert.deepEqual(
    normalizeGlobalLocationViewport({ north: 50, south: 40, west: -90, east: -70, zoom: 30 }),
    { north: 50, south: 40, west: -90, east: -70, zoom: 22 }
  )
  assert.equal(viewportLocationLimit(4), 80)
  assert.equal(viewportLocationLimit(8), 100)
  assert.equal(viewportLocationLimit(10), 120)
  assert.equal(viewportLocationLimit(13), 150)
  assert.equal(viewportLocationLimit(16), 180)
  assert.throws(() => normalizeGlobalLocationViewport({ north: 40, south: 50, west: -90, east: -70, zoom: 10 }), /north must be greater/)
})

test('global serving activates when the endpoint and index are configured', () => {
  const env = { GLOBAL_LOCATION_SEARCH_URL: 'https://search.example.com', GLOBAL_LOCATION_SEARCH_INDEX: 'locations-active' }
  assert.equal(isGlobalLocationSearchConfigured(env), true)
  assert.equal(isGlobalLocationSearchConfigured({ ...env, GLOBAL_LOCATION_SEARCH_URL: '' }), false)
  assert.equal(globalLocationSearchConfig(env).candidateLimit, 500)
})
