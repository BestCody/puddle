import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hydrateOpenSearchRuntimeAuthFromVault,
  normalizeOpenSearchRuntimeEnv
} from '../../instrumentation.js'

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

test('missing Vercel OpenSearch credentials hydrate from the service-role-only Vault RPC', async () => {
  const env = {
    GLOBAL_LOCATION_SEARCH_URL: 'https://search.example.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'service-secret'
  }
  let request
  const fetchFn = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ username: 'puddle-indexer', password: 'vault-secret' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const result = await hydrateOpenSearchRuntimeAuthFromVault(env, { fetchFn })

  assert.equal(result.loaded, true)
  assert.equal(result.source, 'supabase-vault')
  assert.equal(env.OPENSEARCH_USERNAME, 'puddle-indexer')
  assert.equal(env.OPENSEARCH_PASSWORD, 'vault-secret')
  assert.equal(request.url, 'https://project.supabase.co/rest/v1/rpc/get_opensearch_runtime_auth')
  assert.equal(request.options.headers.apikey, 'service-secret')
  assert.equal(normalizeOpenSearchRuntimeEnv(env).authMode, 'basic')
})

test('an existing complete environment credential never calls Vault', async () => {
  const env = {
    GLOBAL_LOCATION_SEARCH_URL: 'https://search.example.com',
    OPENSEARCH_USERNAME: 'puddle-indexer',
    OPENSEARCH_PASSWORD: 'environment-secret'
  }
  const result = await hydrateOpenSearchRuntimeAuthFromVault(env, {
    fetchFn: async () => { throw new Error('Vault should not be called') }
  })

  assert.deepEqual(result, { loaded: false, source: 'environment' })
  assert.equal(env.OPENSEARCH_PASSWORD, 'environment-secret')
})
