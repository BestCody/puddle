import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOpenSearchRuntimeEnv } from '../../instrumentation.js'

test('legacy Vercel OpenSearch env names are normalized to the runtime contract', () => {
  const env = {
    OPENSEARCH_HOST: 'https://search.example.com',
    OPENSEARCH_USER: 'puddle-indexer',
    OPENSEARCH_PASSWORD: 'secret-value'
  }

  const result = normalizeOpenSearchRuntimeEnv(env)

  assert.equal(env.GLOBAL_LOCATION_SEARCH_URL, 'https://search.example.com')
  assert.equal(env.OPENSEARCH_USERNAME, 'puddle-indexer')
  assert.equal(result.endpointConfigured, true)
  assert.equal(result.authMode, 'basic')
  assert.equal(result.usernameConfigured, true)
  assert.equal(result.passwordConfigured, true)
})

test('canonical OpenSearch env names are preserved', () => {
  const env = {
    GLOBAL_LOCATION_SEARCH_URL: 'https://canonical.example.com',
    OPENSEARCH_HOST: 'https://legacy.example.com',
    OPENSEARCH_USERNAME: 'canonical-user',
    OPENSEARCH_USER: 'legacy-user',
    OPENSEARCH_PASSWORD: 'secret-value'
  }

  const result = normalizeOpenSearchRuntimeEnv(env)

  assert.equal(env.GLOBAL_LOCATION_SEARCH_URL, 'https://canonical.example.com')
  assert.equal(env.OPENSEARCH_USERNAME, 'canonical-user')
  assert.equal(result.authMode, 'basic')
})
