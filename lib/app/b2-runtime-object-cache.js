import { createHash } from 'node:crypto'

const DEFAULT_ACTIVE_TTL_SECONDS = 30
const DEFAULT_IMMUTABLE_TTL_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_MAX_RAW_BYTES = 1_400_000
const MAX_PLATFORM_VALUE_BYTES = 2 * 1024 * 1024
const CACHE_NAMESPACE = 'b2-search-v1'
let runtimeCachePromise = null

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function normalizedKey(value) {
  return String(value || '').trim().replace(/^\/+/, '')
}

function activeKey(env) {
  return normalizedKey(env.GLOBAL_LOCATION_SEARCH_MANIFEST_KEY || 'data/search/active.json')
}

function maxRawBytes(env) {
  return integer(env.GLOBAL_LOCATION_RUNTIME_CACHE_MAX_RAW_BYTES, DEFAULT_MAX_RAW_BYTES, 64 * 1024, DEFAULT_MAX_RAW_BYTES)
}

export function b2RuntimeObjectCacheEnabled({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  return env.VERCEL_ENV === 'production' &&
    String(env.GLOBAL_LOCATION_RUNTIME_CACHE || '').trim() === '1' &&
    fetchFn === globalThis.fetch
}

export function b2RuntimeObjectCachePolicy(key, env = process.env) {
  const objectKey = normalizedKey(key)
  if (!objectKey) return null
  if (objectKey === activeKey(env)) {
    return {
      kind: 'active',
      ttl: integer(env.GLOBAL_LOCATION_RUNTIME_CACHE_ACTIVE_TTL_SECONDS, DEFAULT_ACTIVE_TTL_SECONDS, 5, 300)
    }
  }
  if (/^data\/search\/schema=v1\/snapshot=[^/]+\//.test(objectKey)) {
    return {
      kind: 'immutable',
      ttl: integer(env.GLOBAL_LOCATION_RUNTIME_CACHE_IMMUTABLE_TTL_SECONDS, DEFAULT_IMMUTABLE_TTL_SECONDS, 60, 365 * 24 * 60 * 60)
    }
  }
  return null
}

export function b2RuntimeObjectCacheKey(key) {
  return createHash('sha256').update(normalizedKey(key)).digest('hex')
}

async function runtimeCache() {
  if (!runtimeCachePromise) {
    runtimeCachePromise = import('@vercel/functions')
      .then(({ getCache }) => getCache({ namespace: CACHE_NAMESPACE }))
      .catch((error) => {
        runtimeCachePromise = null
        throw error
      })
  }
  return runtimeCachePromise
}

export async function readB2RuntimeObjectCache(key, {
  env = process.env,
  fetchFn = globalThis.fetch,
  maxBytes = Number.POSITIVE_INFINITY
} = {}) {
  if (!b2RuntimeObjectCacheEnabled({ env, fetchFn })) return null
  if (!b2RuntimeObjectCachePolicy(key, env)) return null
  try {
    const cache = await runtimeCache()
    const encoded = await cache.get(b2RuntimeObjectCacheKey(key))
    if (typeof encoded !== 'string' || !encoded.length) return null
    const maximumEncodedLength = Math.ceil((maxRawBytes(env) * 4) / 3) + 8
    if (encoded.length > maximumEncodedLength || Buffer.byteLength(encoded, 'utf8') > MAX_PLATFORM_VALUE_BYTES) return null
    const body = Buffer.from(encoded, 'base64')
    if (!body.length || body.length > Number(maxBytes)) return null
    return body
  } catch {
    return null
  }
}

export async function writeB2RuntimeObjectCache(key, body, {
  env = process.env,
  fetchFn = globalThis.fetch
} = {}) {
  if (!b2RuntimeObjectCacheEnabled({ env, fetchFn })) return false
  const policy = b2RuntimeObjectCachePolicy(key, env)
  if (!policy || !Buffer.isBuffer(body) || !body.length || body.length > maxRawBytes(env)) return false
  const encoded = body.toString('base64')
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PLATFORM_VALUE_BYTES) return false
  try {
    const cache = await runtimeCache()
    await cache.set(b2RuntimeObjectCacheKey(key), encoded, {
      ttl: policy.ttl,
      tags: ['b2-search-runtime'],
      name: `b2-search-${policy.kind}`
    })
    return true
  } catch {
    return false
  }
}

export function resetB2RuntimeObjectCacheForTests() {
  runtimeCachePromise = null
}
