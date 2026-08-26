import { createHash } from 'node:crypto'
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { downloadB2SearchObject } from './b2-search-object-store.js'

const decompress = promisify(brotliDecompress)
const OVERLAY_VERSION = 1
const DEFAULT_ACTIVE_KEY = 'data/search/photo-overlay-v1/active.json'
const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ACTIVE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_DECODED_BYTES = 64 * 1024 * 1024
const BLOOM_MIN_BITS = 1 << 18
const BLOOM_MAX_BITS = 1 << 24
const BLOOM_MIN_HASHES = 1
const BLOOM_MAX_HASHES = 12
const ACTIVE_CACHE = new Map()
const ACTIVE_IN_FLIGHT = new Map()
const OBJECT_CACHE = new Map()
const OBJECT_IN_FLIGHT = new Map()

function normalizedKey(value) {
  return String(value || '').trim().replace(/^\/+/, '')
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function overlayActiveKey(env = process.env) {
  return normalizedKey(env.GLOBAL_LOCATION_PHOTO_OVERLAY_ACTIVE_KEY || DEFAULT_ACTIVE_KEY)
}

function expectedSnapshot(manifest) {
  return String(manifest?.source_snapshot || manifest?.snapshot || '').trim()
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || '').trim())
}

function expectedObjectKey(snapshot, digest) {
  return `data/search/schema=v1/snapshot=${snapshot}/photo-overlay-v1/sha256=${digest}/photos.json.br`
}

function parseBloom(value) {
  if (!value || typeof value !== 'object') return null
  const bitCount = Number(value.bit_count)
  const hashCount = Number(value.hash_count)
  const encoded = String(value.bits || '')
  if (!Number.isInteger(bitCount) || bitCount < BLOOM_MIN_BITS || bitCount > BLOOM_MAX_BITS || (bitCount & (bitCount - 1)) !== 0) {
    throw new Error('B2 photo overlay bloom filter has an invalid bit count.')
  }
  if (!Number.isInteger(hashCount) || hashCount < BLOOM_MIN_HASHES || hashCount > BLOOM_MAX_HASHES) {
    throw new Error('B2 photo overlay bloom filter has an invalid hash count.')
  }
  const bits = Buffer.from(encoded, 'base64')
  if (bits.length !== Math.ceil(bitCount / 8)) throw new Error('B2 photo overlay bloom filter has an invalid payload.')
  return { bitCount, hashCount, bits }
}

function bloomMayContain(id, bloom) {
  if (!bloom) return true
  const digest = createHash('sha256').update(String(id)).digest()
  for (let index = 0; index < bloom.hashCount; index += 1) {
    const offset = (index * 4) % 29
    const bit = digest.readUInt32BE(offset) % bloom.bitCount
    if ((bloom.bits[bit >> 3] & (1 << (bit & 7))) === 0) return false
  }
  return true
}

function validateActive(value, manifest, manifestKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('B2 photo overlay active pointer is invalid.')
  if (Number(value.schema_version) !== 1 || Number(value.overlay_version) !== OVERLAY_VERSION) {
    throw new Error('B2 photo overlay active pointer has an unsupported schema.')
  }
  const snapshot = expectedSnapshot(manifest)
  if (!snapshot || String(value.source_snapshot || '') !== snapshot || String(value.source_manifest_key || '') !== String(manifestKey || '')) {
    throw new Error('B2 photo overlay is not aligned with the active search manifest.')
  }
  const digest = String(value.object_sha256 || '').toLowerCase()
  const objectKey = normalizedKey(value.object_key)
  if (!validSha256(digest) || objectKey !== expectedObjectKey(snapshot, digest)) {
    throw new Error('B2 photo overlay object identity is invalid.')
  }
  const photoCount = Number(value.photo_count)
  if (!Number.isInteger(photoCount) || photoCount < 0) throw new Error('B2 photo overlay photo_count is invalid.')
  return {
    ...value,
    objectKey,
    objectSha256: digest,
    photoCount,
    bloom: parseBloom(value.bloom)
  }
}

async function loadActivePointer(manifest, manifestKey, { env = process.env, fetchFn = fetch, signal } = {}) {
  const key = overlayActiveKey(env)
  if (!key) return null
  const ttl = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_TTL_MS, DEFAULT_TTL_MS, 5_000, 10 * 60_000)
  const cacheKey = `${key}:${manifestKey || ''}`
  const cached = ACTIVE_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < ttl) return cached.value
  const existing = ACTIVE_IN_FLIGHT.get(cacheKey)
  if (existing?.env === env && existing?.fetchFn === fetchFn) return existing.promise

  const promise = (async () => {
    const body = await downloadB2SearchObject(key, {
      env,
      fetchFn,
      signal,
      maxBytes: integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_ACTIVE_BYTES, DEFAULT_MAX_ACTIVE_BYTES, 64 * 1024, 8 * 1024 * 1024),
      missingOk: true
    })
    if (body === null) {
      ACTIVE_CACHE.set(cacheKey, { at: Date.now(), value: null })
      return null
    }
    const value = validateActive(JSON.parse(body.toString('utf8')), manifest, manifestKey)
    ACTIVE_CACHE.set(cacheKey, { at: Date.now(), value })
    return value
  })()
  ACTIVE_IN_FLIGHT.set(cacheKey, { env, fetchFn, promise })
  try {
    return await promise
  } finally {
    if (ACTIVE_IN_FLIGHT.get(cacheKey)?.promise === promise) ACTIVE_IN_FLIGHT.delete(cacheKey)
  }
}

async function loadObject(active, { env = process.env, fetchFn = fetch, signal } = {}) {
  const key = active.objectKey
  const cached = OBJECT_CACHE.get(key)
  if (cached) return cached
  const existing = OBJECT_IN_FLIGHT.get(key)
  if (existing?.env === env && existing?.fetchFn === fetchFn) return existing.promise

  const promise = (async () => {
    const compressed = await downloadB2SearchObject(key, {
      env,
      fetchFn,
      signal,
      maxBytes: integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_BYTES, DEFAULT_MAX_OBJECT_BYTES, 64 * 1024, 32 * 1024 * 1024)
    })
    const digest = createHash('sha256').update(compressed).digest('hex')
    if (digest !== active.objectSha256) throw new Error('B2 photo overlay object checksum does not match its active pointer.')
    const raw = await decompress(compressed)
    const maxDecodedBytes = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_DECODED_BYTES, DEFAULT_MAX_DECODED_BYTES, 1024 * 1024, 256 * 1024 * 1024)
    if (raw.length > maxDecodedBytes) throw new Error('B2 photo overlay decoded payload exceeds the runtime budget.')
    const payload = JSON.parse(raw.toString('utf8'))
    if (!Array.isArray(payload) || Number(payload[0]) !== OVERLAY_VERSION || !Array.isArray(payload[1])) {
      throw new Error('B2 photo overlay payload is invalid.')
    }
    const photos = new Map()
    for (const entry of payload[1]) {
      if (!Array.isArray(entry) || entry.length !== 2 || !String(entry[0] || '').trim()) throw new Error('B2 photo overlay contains an invalid location entry.')
      const photo = entry[1]
      if (!Array.isArray(photo) || !validSha256(photo[0])) throw new Error('B2 photo overlay contains an invalid photo reference.')
      photos.set(String(entry[0]), photo)
    }
    if (photos.size !== active.photoCount) throw new Error('B2 photo overlay count does not match its active pointer.')
    OBJECT_CACHE.set(key, photos)
    return photos
  })()
  OBJECT_IN_FLIGHT.set(key, { env, fetchFn, promise })
  try {
    return await promise
  } finally {
    if (OBJECT_IN_FLIGHT.get(key)?.promise === promise) OBJECT_IN_FLIGHT.delete(key)
  }
}

export function photoObjectFromOverlay(value) {
  if (!Array.isArray(value) || !validSha256(value[0])) return null
  return {
    content_hash: String(value[0]).toLowerCase(),
    provider: value[1] || null,
    attribution: value[2] || null,
    attribution_url: value[3] || null,
    license: value[4] || null,
    width: value[5] ?? null,
    height: value[6] ?? null
  }
}

export async function getPhotoSearchOverlay({ manifest, manifestKey, ids = [], env = process.env, fetchFn = fetch, signal } = {}) {
  const active = await loadActivePointer(manifest, manifestKey, { env, fetchFn, signal })
  if (!active) return null
  const requested = [...new Set((ids || []).map((value) => String(value || '').trim()).filter(Boolean))]
  const possible = requested.filter((id) => bloomMayContain(id, active.bloom))
  if (!possible.length || active.photoCount === 0) {
    return { active: true, photos: new Map(), possibleCount: possible.length, matchedCount: 0, photoCount: active.photoCount }
  }
  const allPhotos = await loadObject(active, { env, fetchFn, signal })
  const photos = new Map()
  for (const id of possible) {
    const photo = allPhotos.get(id)
    if (photo) photos.set(id, photo)
  }
  return { active: true, photos, possibleCount: possible.length, matchedCount: photos.size, photoCount: active.photoCount }
}

export function clearPhotoSearchOverlayCaches() {
  ACTIVE_CACHE.clear()
  ACTIVE_IN_FLIGHT.clear()
  OBJECT_CACHE.clear()
  OBJECT_IN_FLIGHT.clear()
}
