import test from 'node:test'
import assert from 'node:assert/strict'
import {
  b2RuntimeObjectCacheChunkCount,
  b2RuntimeObjectCacheEnabled,
  b2RuntimeObjectCacheKey,
  b2RuntimeObjectCachePolicy,
  isImmutableB2SearchObject
} from '../../lib/app/b2-runtime-object-cache.js'

const env = {
  VERCEL_ENV: 'production',
  GLOBAL_LOCATION_RUNTIME_CACHE: '1',
  GLOBAL_LOCATION_SEARCH_MANIFEST_KEY: 'data/search/active.json',
  GLOBAL_LOCATION_PHOTO_OVERLAY_ACTIVE_KEY: 'data/search/photo-overlay-v1/active.json',
  GLOBAL_LOCATION_PHOTO_OVERLAY_RUNTIME_CACHE_TTL_SECONDS: '45',
  GLOBAL_LOCATION_RUNTIME_CACHE_ACTIVE_TTL_SECONDS: '30',
  GLOBAL_LOCATION_SEARCH_MANIFEST_RUNTIME_CACHE_TTL_SECONDS: '55',
  GLOBAL_LOCATION_RUNTIME_CACHE_MAX_RAW_BYTES: '1400000'
}

test('regional B2 cache defaults on for the real production fetch path', () => {
  assert.equal(b2RuntimeObjectCacheEnabled({ env, fetchFn: globalThis.fetch }), true)
  const { GLOBAL_LOCATION_RUNTIME_CACHE: _flag, ...defaultEnv } = env
  assert.equal(b2RuntimeObjectCacheEnabled({ env: defaultEnv, fetchFn: globalThis.fetch }), true)
  assert.equal(b2RuntimeObjectCacheEnabled({ env: { ...env, VERCEL_ENV: 'preview' }, fetchFn: globalThis.fetch }), false)
  assert.equal(b2RuntimeObjectCacheEnabled({ env, fetchFn: async () => new Response() }), false)
  assert.equal(b2RuntimeObjectCacheEnabled({ env: { ...env, GLOBAL_LOCATION_RUNTIME_CACHE: '0' }, fetchFn: globalThis.fetch }), false)
})

test('runtime cache is limited to active pointers and manifests', () => {
  assert.deepEqual(b2RuntimeObjectCachePolicy('data/search/active.json', env), { kind: 'active', ttl: 30 })
  assert.deepEqual(b2RuntimeObjectCachePolicy('data/search/photo-overlay-v1/active.json', env), { kind: 'photo-overlay-active', ttl: 45 })
  assert.equal(b2RuntimeObjectCachePolicy('data/search/schema=v1/snapshot=2026-08-17/geo/r5/example.json.br', env), null)
  assert.deepEqual(b2RuntimeObjectCachePolicy('data/search/schema=v1/snapshot=2026-08-17/manifest.json', env), { kind: 'manifest', ttl: 55 })
  assert.deepEqual(b2RuntimeObjectCachePolicy('data/search/schema=v1/snapshot=2026-08-17/manifest-planner-a.json', env), { kind: 'manifest', ttl: 55 })
  assert.equal(isImmutableB2SearchObject('data/search/schema=v1/snapshot=2026-08-17/geo/r5/example.json.br'), true)
  assert.equal(isImmutableB2SearchObject(`data/search/objects/v1/sha256=ab/${'a'.repeat(64)}`), true)
  assert.equal(isImmutableB2SearchObject(`data/search/photo-overlay-v2/objects/sha256=${'b'.repeat(64)}/bucket=0f.json.br`), true)
  assert.equal(isImmutableB2SearchObject('data/search/active.json'), false)
  assert.equal(isImmutableB2SearchObject('catalogue/search/schema=v1/snapshot=2026-08-17/geo/r5/example.json.br', { B2_DATA_PREFIX: 'catalogue' }), true)
  assert.equal(b2RuntimeObjectCachePolicy('media/example.jpg', env), null)
  assert.equal(b2RuntimeObjectCachePolicy('data/search/candidates/2026-08-17.json', env), null)
})

test('runtime cache chunks packed objects that exceed one cache item', () => {
  assert.equal(b2RuntimeObjectCacheChunkCount(500_000, env), 1)
  assert.equal(b2RuntimeObjectCacheChunkCount(1_572_864, env), 2)
  assert.equal(b2RuntimeObjectCacheChunkCount(16 * 1024 * 1024, env), 12)
  assert.equal(b2RuntimeObjectCacheChunkCount(16 * 1024 * 1024 + 1, env), 0)
})

test('runtime cache keys are deterministic fixed-width hashes', () => {
  const left = b2RuntimeObjectCacheKey('data/search/schema=v1/snapshot=2026-08-17/example.json.br')
  const right = b2RuntimeObjectCacheKey('/data/search/schema=v1/snapshot=2026-08-17/example.json.br')
  assert.equal(left, right)
  assert.match(left, /^[0-9a-f]{64}$/)
})
