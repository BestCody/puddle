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
