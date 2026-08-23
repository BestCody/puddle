import test from 'node:test'
import assert from 'node:assert/strict'
import { locationSearchRuntimeConfig } from '../../lib/app/location-search-shards.js'

test('B2 search keeps production data budgets while allowing cold object fetches to finish', () => {
  const config = locationSearchRuntimeConfig({})
  assert.equal(config.timeoutMs, 12_000)
  assert.equal(config.fetchConcurrency, 16)
  assert.equal(config.maxCompressedBytes, 16 * 1024 * 1024)
  assert.equal(config.maxCandidates, 150_000)
})

test('legacy 5 second timeout is clamped to a safe cold-fetch floor', () => {
  const config = locationSearchRuntimeConfig({
    GLOBAL_LOCATION_SEARCH_TIMEOUT_MS: '5000',
    GLOBAL_LOCATION_FETCH_CONCURRENCY: '8'
  })
  assert.equal(config.timeoutMs, 10_000)
  assert.equal(config.fetchConcurrency, 8)
  assert.equal(config.maxCompressedBytes, 16 * 1024 * 1024)
})
