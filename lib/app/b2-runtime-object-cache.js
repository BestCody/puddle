import { createHash } from 'node:crypto'
import { getCache, waitUntil } from '@vercel/functions'

const DEFAULT_ACTIVE_TTL_SECONDS = 300
const DEFAULT_IMMUTABLE_TTL_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_CHUNK_RAW_BYTES = 1_400_000
const MAX_CACHEABLE_RAW_BYTES = 16 * 1024 * 1024
const MAX_PLATFORM_VALUE_BYTES = 2 * 1024 * 1024
const CACHE_NAMESPACE = 'b2-search-v2'
let runtimeCacheInstance = null

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

function chunkRawBytes(env) {
  return integer(env.GLOBAL_LOCATION_RUNTIME_CACHE_MAX_RAW_BYTES, DEFAULT_CHUNK_RAW_BYTES, 64 * 1024, DEFAULT_CHUNK_RAW_BYTES)
}

function cacheOptions(policy) {
  return {
    ttl: policy.ttl,
    tags: ['b2-search-runtime'],
    name: `b2-search-${policy.kind}`
  }
}

function cache() {
  if (!runtimeCacheInstance) runtimeCacheInstance = getCache({ namespace: CACHE_NAMESPACE })
  return runtimeCacheInstance
}

function decodeBase64(encoded, maxBytes) {
  if (typeof encoded !== 'string' || !encoded.length || Buffer.byteLength(encoded, 'utf8') > MAX_PLATFORM_VALUE_BYTES) return null
  const body = Buffer.from(encoded, 'base64')
  if (!body.length || body.length > maxBytes) return null
  return body
}

export function b2RuntimeObjectCacheEnabled({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  return env.VERCEL_ENV === 'production' &&
    String(env.GLOBAL_LOCATION_RUNTIME_CACHE ?? '1').trim() !== '0' &&
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

export function b2RuntimeObjectCacheChunkCount(byteLength, env = process.env) {
  const bytes = Math.max(0, Math.trunc(Number(byteLength) || 0))
  if (!bytes || bytes > MAX_CACHEABLE_RAW_BYTES) return 0
  return Math.ceil(bytes / chunkRawBytes(env))
}

export async function readB2RuntimeObjectCache(key, {
  env = process.env,
  fetchFn = globalThis.fetch,
  maxBytes = Number.POSITIVE_INFINITY
} = {}) {
  if (!b2RuntimeObjectCacheEnabled({ env, fetchFn })) return null
  if (!b2RuntimeObjectCachePolicy(key, env)) return null
  try {
    const store = cache()
    const baseKey = b2RuntimeObjectCacheKey(key)
    const entry = await store.get(baseKey)

    if (typeof entry === 'string') return decodeBase64(entry, Number(maxBytes))

    if (!entry || entry.v !== 2 || !Number.isInteger(entry.chunks) || entry.chunks < 2 || entry.chunks > 32) return null
    if (!Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_CACHEABLE_RAW_BYTES || entry.bytes > Number(maxBytes)) return null
    if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) return null

    const encodedChunks = await Promise.all(
      Array.from({ length: entry.chunks }, (_, index) => store.get(`${baseKey}:${index}`))
    )
    const chunks = []
    let total = 0
    for (const encoded of encodedChunks) {
      const chunk = decodeBase64(encoded, chunkRawBytes(env))
      if (!chunk) return null
      total += chunk.length
      if (total > entry.bytes) return null
      chunks.push(chunk)
    }
    if (total !== entry.bytes) return null
    const body = Buffer.concat(chunks, total)
    const digest = createHash('sha256').update(body).digest('hex')
    return digest === entry.sha256 ? body : null
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
  const chunkCount = Buffer.isBuffer(body) ? b2RuntimeObjectCacheChunkCount(body.length, env) : 0
  if (!policy || !chunkCount) return false

  try {
    const store = cache()
    const baseKey = b2RuntimeObjectCacheKey(key)
    const options = cacheOptions(policy)
    if (chunkCount === 1) {
      const encoded = body.toString('base64')
      if (Buffer.byteLength(encoded, 'utf8') > MAX_PLATFORM_VALUE_BYTES) return false
      await store.set(baseKey, encoded, options)
      return true
    }

    const chunkSize = chunkRawBytes(env)
    const encodedChunks = []
    for (let offset = 0; offset < body.length; offset += chunkSize) {
      const encoded = body.subarray(offset, Math.min(body.length, offset + chunkSize)).toString('base64')
      if (Buffer.byteLength(encoded, 'utf8') > MAX_PLATFORM_VALUE_BYTES) return false
      encodedChunks.push(encoded)
    }
    await Promise.all(encodedChunks.map((encoded, index) => store.set(`${baseKey}:${index}`, encoded, options)))
    await store.set(baseKey, {
      v: 2,
      chunks: encodedChunks.length,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex')
    }, options)
    return true
  } catch {
    return false
  }
}

export function queueB2RuntimeObjectCacheWrite(key, body, options = {}) {
  if (!b2RuntimeObjectCacheEnabled(options)) return false
  if (!b2RuntimeObjectCachePolicy(key, options.env || process.env)) return false
  try {
    waitUntil(writeB2RuntimeObjectCache(key, body, options))
    return true
  } catch {
    return false
  }
}

export function resetB2RuntimeObjectCacheForTests() {
  runtimeCacheInstance = null
}
