import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendSettlementReason,
  evaluateLaunchBudgets,
  nextProviderFailure,
  providerFailureAttempts
} from '../../lib/app/static-launch-guards.js'

test('provider failures become terminal on the configured attempt', () => {
  const first = nextProviderFailure(null, 'timeout', 3)
  assert.equal(first.state, 'retryable_failure')
  assert.equal(first.attempts, 1)
  const second = nextProviderFailure(first.error, 'timeout again', 3)
  assert.equal(second.state, 'retryable_failure')
  const third = nextProviderFailure(second.error, 'last timeout', 3)
  assert.equal(third.state, 'skipped')
  assert.equal(third.terminal, true)
  assert.equal(providerFailureAttempts(third.error), 3)
  assert.match(third.error, /final_error=last timeout/)
})

test('settlement preserves the provider failure', () => {
  const value = appendSettlementReason('attempts=2; last_error=rate limited', 'retry_limit_reached')
  assert.match(value, /last_error=rate limited/)
  assert.match(value, /settled=retry_limit_reached/)
})

test('partition budget checks projected B2 bytes and database bytes', () => {
  const result = evaluateLaunchBudgets({
    phase: 'partition',
    currentB2Bytes: 8_950_000_000,
    incomingBytes: 100_000_000,
    supabaseBytes: 399_000_000,
    b2MaxBytes: 9_000_000_000,
    supabaseMaxBytes: 400_000_000
  })
  assert.equal(result.allowed, false)
  assert.equal(result.projectedB2Bytes, 9_050_000_000)
  assert.equal(result.reasons.length, 1)
})

test('photo batches stop at their earlier storage threshold', () => {
  const result = evaluateLaunchBudgets({
    phase: 'photos',
    currentB2Bytes: 8_900_000_000,
    incomingBytes: 0,
    supabaseBytes: 100_000_000,
    b2MaxBytes: 9_000_000_000,
    b2PhotoStartMaxBytes: 8_900_000_000,
    supabaseMaxBytes: 400_000_000
  })
  assert.equal(result.allowed, false)
  assert.match(result.reasons[0], /b2_photo_start_bytes/)
})
