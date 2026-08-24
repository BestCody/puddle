import test from 'node:test'
import assert from 'node:assert/strict'
import {
  b2RuntimeObjectCacheEnabled,
  b2RuntimeObjectCacheKey,
  b2RuntimeObjectCachePolicy
} from '../../lib/app/b2-runtime-object-cache.js'

const env = {
  VERCEL_ENV: 'production',
  GLOBAL_LOCATION_RUNTIME_CACHE: '1',
  GLOBAL_LOCATION_SEARCH_MANIFEST_KEY: 'data/search/active.json',
  GLOBAL_LOCATION_RUNTIME_CACHE_ACTIVE_TTL_SECONDS: '30',
  GLOBAL_LOCATION_RUNTIME_CACHE_IMMUTABLE_TTL_SECONDS: '2592000'
}

test('regional B2 cache is limited to the real production fetch path', () => {
  assert.equal(b2RuntimeObjectCacheEnabled({ env, fetchFn: globalThis.fetch }), true)
  assert.equal(b2RuntimeObjectCacheEnabled({ env: { ...env, VERCEL_ENV: 'preview' }, fetchFn: globalThis.fetch }), false)
  assert.equal(b2RuntimeObjectCacheEnabled({ env, fetchFn: async () => new Response() }), false)
  assert.equal(b2RuntimeObjectCacheEnabled({ env: { ...env, GLOBAL_LOCATION_RUNTIME_CACHE: '0' }, fetchFn: globalThis.fetch }), false)
})

test('active pointer gets a short TTL while snapshot objects are immutable-cache candidates', () => {
  assert.deepEqual(b2RuntimeObjectCachePolicy('data/search/active.json', env), { kind: 'active', ttl: 30 })
  assert.deepEqual(
    b2RuntimeObjectCachePolicy('data/search/schema=v1/snapshot=2026-08-17/geo/r5/example.json.br', env),
    { kind: 'immutable', ttl: 2592000 }
  )
  assert.equal(b2RuntimeObjectCachePolicy('media/example.jpg', env), null)
  assert.equal(b2RuntimeObjectCachePolicy('data/search/candidates/2026-08-17.json', env), null)
})

test('runtime cache keys are deterministic fixed-width hashes', () => {
  const left = b2RuntimeObjectCacheKey('data/search/schema=v1/snapshot=2026-08-17/example.json.br')
  const right = b2RuntimeObjectCacheKey('/data/search/schema=v1/snapshot=2026-08-17/example.json.br')
  assert.equal(left, right)
  assert.match(left, /^[0-9a-f]{64}$/)
})
