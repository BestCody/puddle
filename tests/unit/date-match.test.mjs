import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dateMatchStrength,
  isPositiveDateMatchChoice,
  normalizeDateMatchChoice,
  puddlePickReasons,
  sanitizeDateMatchNote,
  shouldPromptDateFeedback
} from '../../lib/app/date-match-rules.js'

test('DateMatch normalizes legacy swipe actions', () => {
  assert.equal(normalizeDateMatchChoice('dismissed'), 'pass')
  assert.equal(normalizeDateMatchChoice('saved'), 'save')
  assert.equal(normalizeDateMatchChoice('perfect'), 'perfect')
  assert.equal(normalizeDateMatchChoice('unknown'), null)
})

test('mutual saves match and Perfect Picks break ties', () => {
  assert.equal(dateMatchStrength('pass', 'save'), 0)
  assert.equal(dateMatchStrength('save', 'save'), 2)
  assert.equal(dateMatchStrength('perfect', 'save'), 3)
  assert.equal(dateMatchStrength('perfect', 'perfect'), 4)
  assert.equal(isPositiveDateMatchChoice('perfect'), true)
})

test('notes are compact, optional, and bounded', () => {
  assert.equal(sanitizeDateMatchNote('   Looks   cozy   '), 'Looks cozy')
  assert.equal(sanitizeDateMatchNote('   '), null)
  assert.equal(sanitizeDateMatchNote('x'.repeat(400)).length, 280)
})

test('Puddle Pick explanations come from useful place facts', () => {
  const reasons = puddlePickReasons({ category: 'cafe', distance_m: 1800, price_level: 2, amenities: ['views'], open_now: true })
  assert.ok(reasons.includes('Close enough to keep planning easy'))
  assert.ok(reasons.includes('Comfortable everyday price range'))
  assert.ok(reasons.length <= 4)
})

test('post-date feedback waits until one day after the plan', () => {
  const now = new Date('2026-08-03T12:00:00Z')
  assert.equal(shouldPromptDateFeedback({ planned_for: '2026-08-02T11:59:00Z' }, now), true)
  assert.equal(shouldPromptDateFeedback({ planned_for: '2026-08-03T11:59:00Z' }, now), false)
  assert.equal(shouldPromptDateFeedback({ planned_for: '2026-08-01T00:00:00Z', feedback: { happened: true } }, now), false)
})
