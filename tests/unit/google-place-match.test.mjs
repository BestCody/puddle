import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreGooglePlaceMatch } from '../../lib/app/google-place-match.js'

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
