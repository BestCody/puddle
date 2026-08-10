import assert from 'node:assert/strict'
import test from 'node:test'
import {
  candidateConsensusScore,
  googleIdsOnlyQueryVariants,
  googlePlaceTypeCompatible,
  googlePrimaryTypesForKind,
  normalizedGoogleSearchName
} from '../../lib/app/google-place-discovery.js'
import { scoreGoogleNearbyPlaceMatch } from '../../lib/app/google-place-match.js'

test('Puddle kinds map to current Google primary place types', () => {
  assert.deepEqual(googlePrimaryTypesForKind('restaurant'), ['restaurant'])
  assert.deepEqual(googlePrimaryTypesForKind('cafe'), ['cafe', 'coffee_shop'])
  assert.deepEqual(googlePrimaryTypesForKind('shop'), ['store'])
  assert.ok(googlePrimaryTypesForKind('nightlife').includes('night_club'))
  assert.deepEqual(googlePrimaryTypesForKind('unknown_kind'), [])
})

test('type compatibility uses primary and secondary Google types', () => {
  assert.equal(googlePlaceTypeCompatible('cafe', { primaryType: 'coffee_shop', types: ['cafe', 'food'] }), true)
  assert.equal(googlePlaceTypeCompatible('museum', { primaryType: 'restaurant', types: ['restaurant', 'food'] }), false)
  assert.equal(googlePlaceTypeCompatible('museum', {}), true)
})

test('IDs-only discovery creates distinct deterministic query variants', () => {
  const location = {
    name: 'Puddle Coffee Inc.',
    addressPublic: '100 Queen St W',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada'
  }
  const variants = googleIdsOnlyQueryVariants(location)
  assert.ok(variants.length >= 3)
  assert.ok(variants.some((variant) => variant.key === 'name_address'))
  assert.ok(variants.some((variant) => variant.key === 'normalized_name_address'))
  assert.equal(normalizedGoogleSearchName('Puddle Coffee Inc.'), 'Puddle Coffee')
  assert.equal(new Set(variants.map((variant) => variant.query.toLowerCase())).size, variants.length)
})

test('temporary reverse-geocoded address can seed discovery without changing the location object', () => {
  const location = {
    name: 'Addressless Cafe',
    addressPublic: null,
    city: 'Toronto',
    country: 'Canada'
  }
  const variants = googleIdsOnlyQueryVariants(location, { addressOverride: '123 King St W, Toronto, ON' })
  assert.ok(variants.some((variant) => variant.query.includes('123 King St W')))
  assert.equal(location.addressPublic, null)
})

test('candidate consensus increases with independent query evidence', () => {
  const weak = candidateConsensusScore({ variantCount: 1, sightings: 1 })
  const strong = candidateConsensusScore({ variantCount: 4, sightings: 6 })
  assert.ok(strong > weak)
  assert.ok(strong <= 0.99)
})

test('Nearby Search scoring rejects a nearby wrong-type venue', () => {
  const location = {
    name: 'Puddle Museum',
    kind: 'museum',
    latitude: 43.65,
    longitude: -79.38,
    addressPublic: '100 Queen St W, Toronto, ON'
  }
  assert.equal(scoreGoogleNearbyPlaceMatch(location, {
    id: 'restaurant-id',
    displayName: { text: 'Puddle Museum' },
    formattedAddress: '100 Queen St W, Toronto, ON, Canada',
    location: { latitude: 43.6501, longitude: -79.3801 },
    primaryType: 'restaurant',
    types: ['restaurant', 'food']
  }), null)

  const match = scoreGoogleNearbyPlaceMatch(location, {
    id: 'museum-id',
    displayName: { text: 'Puddle Museum' },
    formattedAddress: '100 Queen St W, Toronto, ON, Canada',
    location: { latitude: 43.6501, longitude: -79.3801 },
    primaryType: 'museum',
    types: ['museum', 'tourist_attraction']
  })
  assert.ok(match)
  assert.equal(match.typeCompatible, true)
  assert.equal(match.matchedPrimaryType, 'museum')
})
