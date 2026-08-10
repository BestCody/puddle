import assert from 'node:assert/strict'
import test from 'node:test'
import { findGoogleClientPlace } from '../../lib/app/google-place-client.js'
import {
  scoreGoogleAutocompletePrediction,
  scoreGooglePlaceEssentialsMatch,
  scoreGooglePlaceMatch
} from '../../lib/app/google-place-match.js'

test('Google place matching requires a similar nearby venue', () => {
  const location = { name: 'Puddle Cafe', latitude: 43.65, longitude: -79.38 }
  const match = scoreGooglePlaceMatch(location, {
    displayName: { text: 'Puddle Cafe' },
    location: { latitude: 43.6501, longitude: -79.3801 }
  })
  assert.ok(match)
  assert.ok(match.score > 0.9)
  assert.equal(scoreGooglePlaceMatch(location, {
    displayName: { text: 'Different Store' },
    location: { latitude: 43.6501, longitude: -79.3801 }
  }), null)
})

test('exact venue names tolerate realistic catalogue coordinate drift', () => {
  const location = {
    name: 'Sushi Kaji',
    latitude: 43.638,
    longitude: -79.532,
    addressPublic: '860 The Queensway, Etobicoke, ON'
  }
  const match = scoreGooglePlaceMatch(location, {
    displayName: { text: 'Sushi Kaji' },
    formattedAddress: '860 The Queensway, Etobicoke, ON M8Z 1N7, Canada',
    location: { latitude: 43.6389, longitude: -79.5311 }
  })
  assert.ok(match)
  assert.ok(match.distanceM > 100)
  assert.ok(match.score >= 0.86)
  assert.equal(match.streetNumberMatch, true)
})

test('address evidence accepts a modest venue-name variation without matching another address', () => {
  const location = {
    name: 'Hero Certified Burgers',
    latitude: 43.6532,
    longitude: -79.3832,
    addressPublic: '100 Queen St W, Toronto, ON'
  }
  const sameAddress = scoreGooglePlaceMatch(location, {
    displayName: { text: 'Hero Certified Burgers Toronto' },
    formattedAddress: '100 Queen St W, Toronto, ON M5H 2N2, Canada',
    location: { latitude: 43.6538, longitude: -79.383 }
  })
  assert.ok(sameAddress)
  assert.ok(sameAddress.score >= 0.86)

  assert.equal(scoreGooglePlaceMatch(location, {
    displayName: { text: 'Hero Certified Burgers' },
    formattedAddress: '150 King St W, Toronto, ON, Canada',
    location: { latitude: 43.6545, longitude: -79.3832 }
  }), null)
})

test('Essentials-only verification requires an exact street number, near-identical public address, and nearby pin', () => {
  const location = {
    name: 'Sushi Kaji',
    latitude: 43.638,
    longitude: -79.532,
    addressPublic: '860 The Queensway, Etobicoke, ON'
  }
  const match = scoreGooglePlaceEssentialsMatch(location, {
    id: 'sushi-kaji-place-id',
    formattedAddress: '860 The Queensway, Etobicoke, ON M8Z 1N7, Canada',
    location: { latitude: 43.6385, longitude: -79.5317 }
  })
  assert.ok(match)
  assert.ok(match.score >= 0.94)
  assert.equal(match.streetNumberMatch, true)

  assert.equal(scoreGooglePlaceEssentialsMatch(location, {
    id: 'wrong-number',
    formattedAddress: '862 The Queensway, Etobicoke, ON M8Z 1N7, Canada',
    location: { latitude: 43.6385, longitude: -79.5317 }
  }), null)
  assert.equal(scoreGooglePlaceEssentialsMatch({ ...location, addressPublic: null }, {
    id: 'no-source-address',
    formattedAddress: '860 The Queensway, Etobicoke, ON M8Z 1N7, Canada',
    location: { latitude: 43.6385, longitude: -79.5317 }
  }), null)
})

test('Autocomplete verification requires one strongly matching nearby prediction', () => {
  const location = {
    name: 'Sushi Kaji',
    latitude: 43.638,
    longitude: -79.532,
    addressPublic: '860 The Queensway, Etobicoke, ON'
  }
  const match = scoreGoogleAutocompletePrediction(location, {
    placeId: 'sushi-kaji-place-id',
    structuredFormat: {
      mainText: { text: 'Sushi Kaji' },
      secondaryText: { text: '860 The Queensway, Etobicoke, ON, Canada' }
    },
    distanceMeters: 74
  })
  assert.ok(match)
  assert.ok(match.score >= 0.94)
  assert.equal(match.streetNumberMatch, true)
  assert.equal(match.matchedName, 'Sushi Kaji')

  assert.equal(scoreGoogleAutocompletePrediction(location, {
    placeId: 'wrong-number',
    structuredFormat: {
      mainText: { text: 'Sushi Kaji' },
      secondaryText: { text: '862 The Queensway, Etobicoke, ON, Canada' }
    },
    distanceMeters: 20
  }), null)
  assert.equal(scoreGoogleAutocompletePrediction(location, {
    placeId: 'too-far',
    structuredFormat: {
      mainText: { text: 'Sushi Kaji' },
      secondaryText: { text: '860 The Queensway, Etobicoke, ON, Canada' }
    },
    distanceMeters: 121
  }), null)
  assert.equal(scoreGoogleAutocompletePrediction({ ...location, addressPublic: null }, {
    placeId: 'no-source-address',
    structuredFormat: {
      mainText: { text: 'Sushi Kaji' },
      secondaryText: { text: '860 The Queensway, Etobicoke, ON, Canada' }
    },
    distanceMeters: 10
  }), null)
})

test('Autocomplete verification is stricter for addresses without street numbers', () => {
  const location = {
    name: 'High Park',
    latitude: 43.6465,
    longitude: -79.4637,
    addressPublic: 'High Park, Toronto, ON'
  }
  assert.ok(scoreGoogleAutocompletePrediction(location, {
    placeId: 'high-park',
    structuredFormat: {
      mainText: { text: 'High Park' },
      secondaryText: { text: 'High Park, Toronto, ON, Canada' }
    },
    distanceMeters: 50
  }))
  assert.equal(scoreGoogleAutocompletePrediction(location, {
    placeId: 'high-park-far',
    structuredFormat: {
      mainText: { text: 'High Park' },
      secondaryText: { text: 'High Park, Toronto, ON, Canada' }
    },
    distanceMeters: 81
  }), null)
})

test('browser Google lookup uses bounded fields and the same identity scorer', async () => {
  let request = null
  const Place = {
    async searchByText(value) {
      request = value
      return {
        places: [
          {
            id: 'wrong-place',
            displayName: 'Different Store',
            formattedAddress: '900 The Queensway, Etobicoke, ON',
            location: { lat: () => 43.6387, lng: () => -79.5313 }
          },
          {
            id: 'sushi-kaji-place-id',
            displayName: 'Sushi Kaji',
            formattedAddress: '860 The Queensway, Etobicoke, ON M8Z 1N7, Canada',
            location: { lat: () => 43.6389, lng: () => -79.5311 }
          }
        ]
      }
    }
  }
  const found = await findGoogleClientPlace(Place, {
    allowed: true,
    name: 'Sushi Kaji',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    addressPublic: '860 The Queensway, Etobicoke, ON',
    latitude: 43.638,
    longitude: -79.532,
    minimumScore: 0.86
  })

  assert.equal(found?.placeId, 'sushi-kaji-place-id')
  assert.deepEqual(request.fields, ['id', 'displayName', 'formattedAddress', 'location'])
  assert.equal(request.maxResultCount, 5)
  assert.equal(request.region, 'ca')
  assert.deepEqual(request.locationBias, { center: { lat: 43.638, lng: -79.532 }, radius: 200 })
})

test('browser Google lookup refuses unrelated or unbudgeted places', async () => {
  const Place = {
    async searchByText() {
      return {
        places: [{
          id: 'wrong-place',
          displayName: 'Different Store',
          formattedAddress: '900 The Queensway, Etobicoke, ON',
          location: { lat: () => 43.6387, lng: () => -79.5313 }
        }]
      }
    }
  }
  const lookup = {
    allowed: true,
    name: 'Sushi Kaji',
    city: 'Toronto',
    country: 'Canada',
    latitude: 43.638,
    longitude: -79.532
  }
  assert.equal(await findGoogleClientPlace(Place, lookup), null)
  assert.equal(await findGoogleClientPlace(Place, { ...lookup, allowed: false }), null)
})
