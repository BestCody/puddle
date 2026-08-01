import test from 'node:test'
import assert from 'node:assert/strict'
import {
  angleDifference,
  bearingDegrees,
  commonsCandidateScore,
  haversineMeters,
  providerOrderForCategory,
  streetCandidateScore,
  tokenSimilarity
} from '../../lib/app/open-photo-candidates.js'

test('distance, bearing, and angle helpers are stable', () => {
  assert.ok(haversineMeters(43.6532, -79.3832, 43.6533, -79.3832) < 12)
  assert.ok(bearingDegrees(43.6532, -79.3832, 43.6542, -79.3832) < 1)
  assert.equal(angleDifference(350, 10), 20)
})

test('street candidates require a nearby camera facing the location', () => {
  const location = { latitude: 43.6532, longitude: -79.3832 }
  const facing = streetCandidateScore({
    location,
    image: { latitude: 43.6531, longitude: -79.3832, heading: 0, capturedAt: new Date().toISOString(), width: 1600, height: 1000 }
  })
  const facingAway = streetCandidateScore({
    location,
    image: { latitude: 43.6531, longitude: -79.3832, heading: 180, capturedAt: new Date().toISOString(), width: 1600, height: 1000 }
  })
  assert.ok(facing?.score > 0.7)
  assert.equal(facingAway, null)
})

test('Commons candidates require both geospatial and title agreement', () => {
  const location = { name: 'Royal Ontario Museum', latitude: 43.6677, longitude: -79.3948 }
  const matching = commonsCandidateScore({
    location,
    image: { title: 'Royal Ontario Museum exterior.jpg', description: '', latitude: 43.6678, longitude: -79.3948, width: 1600, height: 1000 }
  })
  const unrelated = commonsCandidateScore({
    location,
    image: { title: 'Toronto coffee shop.jpg', description: '', latitude: 43.6678, longitude: -79.3948, width: 1600, height: 1000 }
  })
  assert.ok(matching?.score > 0.7)
  assert.equal(unrelated, null)
  assert.equal(tokenSimilarity('Royal Ontario Museum', 'Royal Ontario Museum exterior'), 1)
})

test('public attractions check Commons before street imagery', () => {
  assert.deepEqual(providerOrderForCategory('museum'), ['wikimedia-commons', 'mapillary', 'kartaview'])
  assert.deepEqual(providerOrderForCategory('restaurant'), ['mapillary', 'kartaview', 'wikimedia-commons'])
})
