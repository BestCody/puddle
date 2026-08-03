import assert from 'node:assert/strict'
import test from 'node:test'
import {
  categoryPlaceholderUrl,
  fetchNearbyStaticPlaces,
  lonLatToTile,
  packStaticPlace,
  tileCoordinatesForRadius,
  unpackStaticPlace
} from '../../lib/app/static-catalogue.js'

test('static catalogue place records round trip through the compact array schema', () => {
  const item = {
    source: 'overture', sourcePlaceId: 'abc', name: 'Test Cafe', slug: 'test-cafe-abc', kind: 'cafe',
    latitude: 43.65, longitude: -79.38, city: 'Toronto', country: 'Canada', countryCode: 'CA',
    normalizationVersion: 2, categoryMappingVersion: 2, amenities: ['wifi'], openingHours: {}
  }
  const unpacked = unpackStaticPlace(packStaticPlace(item))
  assert.equal(unpacked.sourcePlaceId, 'abc')
  assert.equal(unpacked.name, 'Test Cafe')
  assert.equal(unpacked.latitude, 43.65)
  assert.deepEqual(unpacked.amenities, ['wifi'])
})

test('nearby tile selection is deterministic and bounded', () => {
  const tile = lonLatToTile(-79.38, 43.65, 10)
  assert.deepEqual(tile, lonLatToTile(-79.38, 43.65, 10))
  const nearby = tileCoordinatesForRadius(43.65, -79.38, 10, 10)
  assert.ok(nearby.length >= 1)
  assert.ok(nearby.length < 20)
  assert.ok(nearby.some((candidate) => candidate.x === tile.x && candidate.y === tile.y))
})

test('runtime loader filters tile records by distance', async () => {
  const near = packStaticPlace({
    source: 'overture', sourcePlaceId: 'near', name: 'Near', slug: 'near', kind: 'park',
    latitude: 43.6502, longitude: -79.3802, normalizationVersion: 2, categoryMappingVersion: 2
  })
  const far = packStaticPlace({
    source: 'overture', sourcePlaceId: 'far', name: 'Far', slug: 'far', kind: 'park',
    latitude: 45, longitude: -79, normalizationVersion: 2, categoryMappingVersion: 2
  })
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).endsWith('/catalogue/manifest.json')
      ? { schema: 1, release: 'test', zoom: 10 }
      : { v: 1, p: [near, far] }
  })
  const result = await fetchNearbyStaticPlaces({
    latitude: 43.65, longitude: -79.38, radiusKm: 5, baseUrl: 'https://assets.example.com', fetchImpl
  })
  assert.deepEqual(result.places.map((place) => place.sourcePlaceId), ['near'])
})

test('category placeholders use a stable safe path', () => {
  assert.equal(categoryPlaceholderUrl('cafe', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/cafe.svg')
  assert.equal(categoryPlaceholderUrl('unknown', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/other.svg')
})
