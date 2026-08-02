import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyCatalogueRpcError,
  reconcileCatalogueRpcResults,
  writeCatalogueBatchAdaptive
} from '../../lib/app/catalogue-batch-writer.js'

function items(count) {
  return Array.from({ length: count }, (_, index) => ({ sourcePlaceId: `place-${index + 1}` }))
}

function successfulRows(chunk) {
  return chunk.map((item) => ({
    source_place_id: item.sourcePlaceId,
    location_id: `location-${item.sourcePlaceId}`,
    error_message: null
  }))
}

test('classifies database contention separately from transient transport failures', () => {
  assert.deepEqual(classifyCatalogueRpcError({ code: '57014', message: 'canceling statement due to statement timeout' }), {
    code: '57014', status: null, retryable: true, splittable: true
  })
  const unavailable = classifyCatalogueRpcError({ status: 503, message: 'Service unavailable' })
  assert.equal(unavailable.retryable, true)
  assert.equal(unavailable.splittable, false)
  const invalid = classifyCatalogueRpcError({ code: '42883', message: 'function does not exist' })
  assert.equal(invalid.retryable, false)
  assert.equal(invalid.splittable, false)
})

test('retries a timed-out batch and then subdivides it without losing successful records', async () => {
  const input = items(4)
  const calls = []
  const events = []
  const outcome = await writeCatalogueBatchAdaptive({
    items: input,
    maxRetries: 1,
    retryDelayMs: 0,
    sleep: async () => {},
    onEvent: (event) => events.push(event),
    invoke: async (chunk) => {
      calls.push(chunk.map((item) => item.sourcePlaceId))
      if (chunk.length === 4) {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      }
      return { data: successfulRows(chunk), error: null }
    }
  })

  assert.deepEqual(calls.map((call) => call.length), [4, 4, 2, 2])
  assert.equal(outcome.successes.length, 4)
  assert.equal(outcome.failures.length, 0)
  assert.equal(outcome.fatalError, null)
  assert.deepEqual(outcome.metrics, {
    rpcCalls: 4,
    rpcRetries: 1,
    rpcSplits: 1,
    smallestRpcBatch: 2,
    largestRpcBatch: 4
  })
  assert.equal(events.filter((event) => event.type === 'retry').length, 1)
  assert.equal(events.filter((event) => event.type === 'split').length, 1)
})

test('retries a transient gateway failure without creating a request storm', async () => {
  let calls = 0
  const outcome = await writeCatalogueBatchAdaptive({
    items: items(3),
    maxRetries: 2,
    retryDelayMs: 0,
    sleep: async () => {},
    invoke: async (chunk) => {
      calls += 1
      if (calls === 1) return { data: null, error: { status: 503, message: 'Service unavailable' } }
      return { data: successfulRows(chunk), error: null }
    }
  })
  assert.equal(calls, 2)
  assert.equal(outcome.successes.length, 3)
  assert.equal(outcome.metrics.rpcSplits, 0)
})

test('treats an exhausted network outage as fatal instead of recursively flooding the service', async () => {
  let calls = 0
  const outcome = await writeCatalogueBatchAdaptive({
    items: items(8),
    maxRetries: 1,
    retryDelayMs: 0,
    sleep: async () => {},
    invoke: async () => {
      calls += 1
      throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })
    }
  })
  assert.equal(calls, 2)
  assert.equal(outcome.successes.length, 0)
  assert.equal(outcome.failures.length, 8)
  assert.match(outcome.fatalError.message, /fetch failed/)
  assert.equal(outcome.metrics.rpcSplits, 0)
})

test('isolates persistent statement timeouts to individual records', async () => {
  const outcome = await writeCatalogueBatchAdaptive({
    items: items(3),
    maxRetries: 0,
    retryDelayMs: 0,
    invoke: async () => ({
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout' }
    })
  })
  assert.equal(outcome.successes.length, 0)
  assert.equal(outcome.failures.length, 3)
  assert.equal(outcome.fatalError, null)
  assert.equal(outcome.metrics.rpcCalls, 5)
  assert.equal(outcome.metrics.rpcSplits, 2)
  assert.equal(outcome.metrics.smallestRpcBatch, 1)
})

test('reports row-level RPC contract failures against only the affected records', () => {
  const input = items(4)
  const reconciled = reconcileCatalogueRpcResults(input, [
    { source_place_id: 'place-1', location_id: 'location-1', error_message: null },
    { source_place_id: 'place-2', location_id: null, error_message: 'trigger rejected record' },
    { source_place_id: 'place-3', location_id: null, error_message: null }
  ])
  assert.equal(reconciled.successes.length, 1)
  assert.equal(reconciled.failures.length, 3)
  assert.match(reconciled.failures[0].error.message, /trigger rejected/)
  assert.match(reconciled.failures[1].error.message, /no canonical location ID/)
  assert.match(reconciled.failures[2].error.message, /no result/)
  assert.equal(reconciled.fatalError, null)
})

test('fails closed on malformed, duplicate, or unexpected RPC responses', () => {
  const input = items(2)
  assert.match(reconcileCatalogueRpcResults(input, null).fatalError.message, /non-array/)
  assert.match(reconcileCatalogueRpcResults(input, [
    { source_place_id: 'place-1', location_id: 'one' },
    { source_place_id: 'place-1', location_id: 'two' }
  ]).fatalError.message, /duplicate results/)
  assert.match(reconcileCatalogueRpcResults(input, [
    { source_place_id: 'other-place', location_id: 'other' }
  ]).fatalError.message, /unexpected source_place_id/)
})
