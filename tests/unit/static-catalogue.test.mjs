import assert from 'node:assert/strict'
import test from 'node:test'
import {
  categoryPlaceholderUrl,
  fetchNearbyStaticPlaces,
  fetchStaticPlaceByReference,
  fetchStaticPlacesByReferences,
  lonLatToTile,
  packStaticDetail,
  packStaticPlace,
  packStaticProvenance,
  staticCatalogueSchema,
  tileCoordinatesForRadius,
  unpackStaticDetail,
  unpackStaticPlace,
  unpackStaticProvenance
} from '../../lib/app/static-catalogue.js'
import { staticCatalogueLocationId } from '../../lib/app/static-catalogue-id.js'

test('deck, detail, and provenance records use separate compact schemas', () => {
  const item = {
    source: 'overture', sourcePlaceId: 'abc', name: 'Test Cafe', kind: 'cafe',
    latitude: 43.650123, longitude: -79.380456, city: 'Toronto', country: 'Canada', countryCode: 'CA',
    priceLevel: 2, amenities: ['wifi'], openingHours: { monday: '09:00-17:00' },
    accessibility: { wheelchair_accessible: true, step_free: false },
    addressPublic: '1 Test Street', normalizationVersion: 2, categoryMappingVersion: 2,
    payloadHash: 'a'.repeat(64), sourceMetadata: { fixture: true }
  }
  const deck = unpackStaticPlace(packStaticPlace(item))
  const detail = unpackStaticDetail(packStaticDetail(item))
  const provenance = unpackStaticProvenance(packStaticProvenance(item))
  assert.equal(staticCatalogueSchema.version, 3)
  assert.equal(deck.sourcePlaceId, 'abc')
  assert.equal(deck.name, 'Test Cafe')
  assert.equal(deck.latitude, 43.65012)
  assert.equal(deck.addressPublic, undefined)
  assert.deepEqual(deck.amenities, ['wifi'])
  assert.deepEqual(deck.openingHours, { monday: '09:00-17:00' })
  assert.deepEqual(deck.accessibility, { wheelchair_accessible: true, step_free: false })
  assert.equal(detail.addressPublic, '1 Test Street')
  assert.equal(detail.amenities, undefined)
  assert.equal(detail.payloadHash, undefined)
  assert.equal(provenance.payloadHash, 'a'.repeat(64))
  assert.deepEqual(provenance.sourceMetadata, { fixture: true })
  assert.ok(staticCatalogueSchema.placeFields.length < 20)
  assert.ok(staticCatalogueSchema.detailFields.length < staticCatalogueSchema.placeFields.length)
})

test('nearby tile selection starts at the center and stays bounded', () => {
  const tile = lonLatToTile(-79.38, 43.65, 10)
  const nearby = tileCoordinatesForRadius(43.65, -79.38, 10, 10)
  assert.ok(nearby.length >= 1)
  assert.ok(nearby.length < 20)
  assert.equal(nearby[0].x, tile.x)
  assert.equal(nearby[0].y, tile.y)
})

test('runtime loader joins media overlays and stops after enough progressive tiles', async () => {
  const near = packStaticPlace({ source: 'overture', sourcePlaceId: 'near', name: 'Near', kind: 'park', latitude: 43.6502, longitude: -79.3802 })
  const far = packStaticPlace({ source: 'overture', sourcePlaceId: 'far', name: 'Far', kind: 'park', latitude: 45, longitude: -79 })
  const nearId = staticCatalogueLocationId('overture', 'near')
  const requests = []
  const fetchImpl = async (url) => {
    const value = String(url)
    requests.push(value)
    const payload = value.endsWith('/catalogue/manifest.json')
      ? { schema: 3, release: 'test', zoom: 10 }
      : value.includes('/catalogue/media/')
        ? { v: 1, m: [[nearId, 'https://assets.example.com/photo.avif', 'wikimedia-commons', 'Author', 'https://example.com/source', 'CC-BY-4.0', null, null]] }
        : { v: 3, p: [near, far] }
    return { ok: true, status: 200, json: async () => payload }
  }
  const previous = process.env.STATIC_CATALOGUE_TILE_CONCURRENCY
  process.env.STATIC_CATALOGUE_TILE_CONCURRENCY = '1'
  try {
    const result = await fetchNearbyStaticPlaces({ latitude: 43.65, longitude: -79.38, radiusKm: 5, limit: 1, baseUrl: 'https://assets.example.com', fetchImpl })
    assert.deepEqual(result.places.map((place) => place.sourcePlaceId), ['near'])
    assert.equal(result.places[0].media.photoUrl, 'https://assets.example.com/photo.avif')
    assert.equal(result.tilesRequested, 1)
    assert.equal(requests.filter((url) => url.includes('/tiles/')).length, 1)
  } finally {
    if (previous === undefined) delete process.env.STATIC_CATALOGUE_TILE_CONCURRENCY
    else process.env.STATIC_CATALOGUE_TILE_CONCURRENCY = previous
  }
})

test('signed references sharing a tile resolve with one deck and one detail fetch', async () => {
  const firstDeck = packStaticPlace({ source: 'overture', sourcePlaceId: 'one', name: 'One', kind: 'cafe', latitude: 43.65, longitude: -79.38 })
  const secondDeck = packStaticPlace({ source: 'overture', sourcePlaceId: 'two', name: 'Two', kind: 'park', latitude: 43.651, longitude: -79.381 })
  const firstDetail = packStaticDetail({ source: 'overture', sourcePlaceId: 'one', addressPublic: '1 Main' })
  const secondDetail = packStaticDetail({ source: 'overture', sourcePlaceId: 'two', addressPublic: '2 Main' })
  const firstId = staticCatalogueLocationId('overture', 'one')
  const secondId = staticCatalogueLocationId('overture', 'two')
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => String(url).includes('/details/')
        ? { v: 3, d: [firstDetail, secondDetail] }
        : { v: 3, p: [firstDeck, secondDeck] }
    }
  }
  const tile = { z: 10, x: 100, y: 200 }
  const references = [
    { id: firstId, source: 'overture', sourcePlaceId: 'one', release: 'r1', tile },
    { id: secondId, source: 'overture', sourcePlaceId: 'two', release: 'r1', tile }
  ]
  const places = await fetchStaticPlacesByReferences(references, { baseUrl: 'https://assets.example.com', fetchImpl })
  assert.equal(places.get(firstId).addressPublic, '1 Main')
  assert.equal(places.get(secondId).addressPublic, '2 Main')
  assert.equal(requests.filter((url) => url.includes('/tiles/')).length, 1)
  assert.equal(requests.filter((url) => url.includes('/details/')).length, 1)
  const single = await fetchStaticPlaceByReference(references[0], { baseUrl: 'https://assets.example.com', fetchImpl })
  assert.equal(single.contentId, firstId)
})

test('category placeholders use a stable safe path', () => {
  assert.equal(categoryPlaceholderUrl('cafe', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/cafe.svg')
  assert.equal(categoryPlaceholderUrl('unknown', 'https://assets.example.com'), 'https://assets.example.com/catalogue/placeholders/other.svg')
})
