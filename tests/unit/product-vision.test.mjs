import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isLegacyApiPath,
  legacyRedirectForPath,
  legacySystemsEnabled
} from '../../lib/product-vision.js'

test('legacy systems are disabled unless explicitly enabled', () => {
  assert.equal(legacySystemsEnabled({}), false)
  assert.equal(legacySystemsEnabled({ PUDDLE_LEGACY_SYSTEMS_ENABLED: 'false' }), false)
  assert.equal(legacySystemsEnabled({ PUDDLE_LEGACY_SYSTEMS_ENABLED: 'true' }), true)
  assert.equal(legacySystemsEnabled({ PUDDLE_LEGACY_SYSTEMS_ENABLED: '1' }), true)
})

test('legacy pages redirect to the closest location-first surface', () => {
  assert.equal(legacyRedirectForPath('/create'), '/create/place')
  assert.equal(legacyRedirectForPath('/create/event'), '/create/place')
  assert.equal(legacyRedirectForPath('/studio'), '/create/place')
  assert.equal(legacyRedirectForPath('/studio/events/123'), '/discover')
  assert.equal(legacyRedirectForPath('/events/summer-festival'), '/discover')
  assert.equal(legacyRedirectForPath('/wallet/tickets/123'), '/plans')
  assert.equal(legacyRedirectForPath('/plans/123'), '/plans')
  assert.equal(legacyRedirectForPath('/discover'), null)
  assert.equal(legacyRedirectForPath('/date-match/token'), null)
  assert.equal(legacyRedirectForPath('/places/cafe'), null)
  assert.equal(legacyRedirectForPath('/studio/places/123'), null)
})

test('legacy APIs are rejected while location APIs remain active', () => {
  assert.equal(isLegacyApiPath('/api/stripe/webhook'), true)
  assert.equal(isLegacyApiPath('/api/location-sharing/expire'), true)
  assert.equal(isLegacyApiPath('/api/ai/assist'), true)
  assert.equal(isLegacyApiPath('/api/drafts/event'), true)
  assert.equal(isLegacyApiPath('/api/date-match/start'), false)
  assert.equal(isLegacyApiPath('/api/discovery/action'), false)
  assert.equal(isLegacyApiPath('/api/drafts/place'), false)
  assert.equal(isLegacyApiPath('/api/media/upload'), false)
})
