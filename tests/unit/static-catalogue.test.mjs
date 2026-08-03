import assert from 'node:assert/strict'
import test from 'node:test'
import {
  categoryPlaceholderUrl,
  fetchNearbyStaticPlaces,
  fetchStaticPlaceByReference,
  lonLatToTile,
  packStaticDetail,
  packStaticPlace,
  staticCatalogueSchema,
  tileCoordinatesForRadius,
  unpackStaticDetail,
  unpackStaticPlace
} from '../../lib/app/static-catalogue.js'
import { staticCatalogueLocationId } from '../../lib/app/static-catalogue-id.js'

test('deck and detail records round trip through separate compact schemas', () => {
  const item = {
    source: 'overture', sourcePlaceId: 'abc', name: 'Test Cafe', kind: 'cafe',
    latitude: 43.650123, longitude: -79.380456, city: 'Toronto', country: 'Canada', countryCode: 'CA',
    priceLevel: 2, amenities: ['wifi'], openingHours: { monday: '09:00-17:00' },
    addressPublic: '1 Test Street', normalizationVersion: 2, categoryMappingVersion: 2
  }
  const deck = unpackStaticPlace(packStaticPlace(item))
  const detail = unpackStaticDetail(packStaticDetail(item))
  assert.equal(deck.sourcePlaceId, 'abc')
  assert.equal(deck.name, 'Test Cafe')
  assert.equal(deck.latitude, 43.65012)
  assert.equal(deck.addressPublic, undefined)
  assert.equal(detail.addressPublic, '1 Test Street')
  assert.deepEqual(detail.amenities, ['wifi'])
  assert.ok(staticCatalogueSchema.placeFields.length < 20)
})

test('nearby tile selection starts at the center and stays bounded', () => {
  const tile = lonLatToTile(-79.38, 43.65, 10)
  const nearby = tileCoordinatesForRadius(43.65, -79.38, 10, 10)
  assert.ok(nearby.length >= 1)
  assert.ok(nearby.length < 20)
  assert.equal(nearby[0].x, tile.x)
  assert.equal(nearby[0].y, tile.y)
})

test('runtime loader joins media overlays while filtering by distance', async () => {
  const near = packStaticPlace({ source: 'overture', sourcePlaceId: 'near', name: 'Near', kind: 'park', latitude: 43.6502, longitude: -79.3802 })
  const far = packStaticPlace({ source: 'overture', sourcePlaceId: 'far', name: 'Far', kind: 'park', latitude: 45, longitude: -79 })
  const nearId = staticCatalogueLocationId('overture', 'near')
  const fetchImpl = async (url) => {
    const value = String(url)
    const payload = value.endsWith('/catalogue/manifest.json')
      ? { schema: 2, release: 'test', zoom: 10 }
      : value.includes('/catalogue/media/')
        ? { v: 1, m: [[nearId, 'https://assets.example.com/photo.avif', 'wikimedia-commons', 'Author', 'https://example.com/source', 'CC-BY-4.0', null, null]] }
        : { v: 2, p: [near, far] }
    return { ok: true, status: 200, json: async () => payload }
  }
  const result = await fetchNearbyStaticPlaces({ latitude: 43.65, longitude: -79.38, radiusKm: 5, baseUrl: 'https://assets.example.com', fetchImpl })
  assert.deepEqual(result.places.map((place) => place.sourcePlaceId), ['near'])
  assert.equal(result.places[0].media.photoUrl, 'https://assets.example.com/photo.avif')
})

test('a signed reference resolves one exact deck/detail tile', async () => {
  const deck = packStaticPlace({ source: 'overture', sourcePlaceId: 'one', name: 'One', kind: 'cafe', latitude: 43.65, longitude: -79.38 })
  const detail = packStaticDetail({ source: 'overture', sourcePlaceId: 'one', addressPublic: '1 Main', amenities: ['wifi'] })
  const id = staticCatalogueLocationId('overture', 'one')
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/details/') ? { v: 2, d: [detail] } : { v: 2, p: [deck] }
  })
  const place = await fetchStaticPlaceByReference({ id, source: 'overture', sourcePlaceId: 'one', release: 'r1', tile: { z: 10, x: 100, y: 200 } }, { baseUrl: 'https://assets.example.com', fetchImpl })
  assert.equal(place.contentId, id)
  assert.equal(place.addressPublic, '1 Main')
  assert.deepEqual(place.amenities, ['wifi'])
})

test('category placeholders use a stable safe path', () => {
  assert.equal(categoryPlaceholderUrl('cafe', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/cafe.svg')
  assert.equal(categoryPlaceholderUrl('unknown', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/other.svg')
})
