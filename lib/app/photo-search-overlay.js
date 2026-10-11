import { createHash } from 'node:crypto'
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { downloadSearchObject } from './search-object-store.js'

const decompress = promisify(brotliDecompress)
const OVERLAY_VERSION = 2
const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ACTIVE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_OBJECT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_DECODED_BYTES = 64 * 1024 * 1024

const PHOTO_OBJECT_CACHE_BYTES = 16 * 1024 * 1024
const ACTIVE_CACHE = new Map()
const ACTIVE_CACHE_LIMIT = 4
const ACTIVE_IN_FLIGHT = new Map()
const OBJECT_CACHE = new Map()
const OBJECT_IN_FLIGHT = new Map()
let photoObjectCacheBytes = 0

function cacheActivePointer(key, value) {
  ACTIVE_CACHE.delete(key)
  ACTIVE_CACHE.set(key, { at: Date.now(), value })
  while (ACTIVE_CACHE.size > ACTIVE_CACHE_LIMIT) ACTIVE_CACHE.delete(ACTIVE_CACHE.keys().next().value)
}

function normalizedKey(value) {
  return String(value || '').trim().replace(/^\/+/, '')
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function overlayActiveKey(env = process.env) {
  const dataPrefix = normalizedKey(env.PUDDLE_DATA_PREFIX || 'data')
  return normalizedKey(env.GLOBAL_LOCATION_PHOTO_OVERLAY_ACTIVE_KEY || `${dataPrefix}/search/photo-overlay-v1/active.json`)
}

function expectedSnapshot(manifest) {
  return String(manifest?.source_snapshot || manifest?.snapshot || '').trim()
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || '').trim())
}

function searchPrefix(manifest) {
  const prefix = normalizedKey(manifest?.prefix)
  const marker = '/schema=v1/snapshot='
  const markerIndex = prefix.indexOf(marker)
  return markerIndex > 0 ? prefix.slice(0, markerIndex) : ''
}

function expectedShardedObjectKey(bucket, digest, manifest) {
  const prefix = searchPrefix(manifest)
  if (!prefix) return ''
  return `${prefix}/photo-overlay-v2/objects/sha256=${digest}/bucket=${bucket}.json.br`
}

function validBucketCount(value) {
  const count = Number(value)
  return Number.isInteger(count) && count >= 2 && count <= 4096 && (count & (count - 1)) === 0 ? count : 0
}

function photoBucket(identifier, bucketCount) {
  const digest = createHash('sha256').update(String(identifier)).digest()
  const window = bucketCount <= 256 ? digest[0] : digest.readUInt16BE(0)
  const width = Math.max(2, Math.ceil(Math.log2(bucketCount) / 4))
  return (window & (bucketCount - 1)).toString(16).padStart(width, '0')
}

function compareUuidWords(bytes, offset, words) {
  for (let index = 0; index < 4; index += 1) {
    const value = bytes.readUInt32BE(offset + index * 4)
    if (value !== words[index]) return value < words[index] ? -1 : 1
  }
  return 0
}

function parseMembership(value, count) {
  if (!value) throw new Error('Photo overlay exact membership is required.')
  if (value.encoding !== 'uuid128-sorted') throw new Error('Unsupported photo membership encoding.')
  const bytes = Buffer.from(String(value.ids_base64 || ''), 'base64')
  if (bytes.length !== count * 16 || createHash('sha256').update(bytes).digest('hex') !== value.sha256) {
    throw new Error('Photo membership length or checksum is invalid.')
  }
  for (let offset = 16; offset < bytes.length; offset += 16) {
    const words = [0, 4, 8, 12].map(index => bytes.readUInt32BE(offset + index))
    if (compareUuidWords(bytes, offset - 16, words) >= 0) throw new Error('Photo membership must be unique and sorted.')
  }
  return id => {
    const value = String(id)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false
    const hex = value.replaceAll('-', '')
    const words = [0, 8, 16, 24].map(offset => Number.parseInt(hex.slice(offset, offset + 8), 16))
    let low = 0
    let high = count - 1
    while (low <= high) {
      const middle = (low + high) >>> 1
      const comparison = compareUuidWords(bytes, middle * 16, words)
      if (!comparison) return true
      if (comparison < 0) low = middle + 1
      else high = middle - 1
    }
    return false
  }
}

function validateActive(value, manifest, manifestKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object store photo overlay active pointer is invalid.')
  if (Number(value.schema_version) !== 1 || Number(value.overlay_version) !== OVERLAY_VERSION) {
    throw new Error('object store photo overlay active pointer has an unsupported schema.')
  }
  const overlayVersion = Number(value.overlay_version)
  const snapshot = expectedSnapshot(manifest)
  if (!snapshot || String(value.source_snapshot || '') !== snapshot || String(value.source_manifest_key || '') !== String(manifestKey || '')) {
    throw new Error('object store photo overlay is not aligned with the active search manifest.')
  }
  const photoCount = Number(value.photo_count)
  if (!Number.isInteger(photoCount) || photoCount < 0) throw new Error('object store photo overlay photo_count is invalid.')
  const hasPhoto = parseMembership(value.membership, photoCount)
  const bucketCount = validBucketCount(value.bucket_count)
  if (!bucketCount) throw new Error('object store photo overlay bucket_count is invalid.')
  if (!value.shards || typeof value.shards !== 'object' || Array.isArray(value.shards)) {
    throw new Error('object store photo overlay shards are invalid.')
  }
  const shards = {}
  let shardPhotoCount = 0
  for (const [bucket, shard] of Object.entries(value.shards)) {
    const bucketWidth = Math.max(2, Math.ceil(Math.log2(bucketCount) / 4))
    if (bucket.length !== bucketWidth || !/^[0-9a-f]+$/.test(bucket) || parseInt(bucket, 16) >= bucketCount || !shard || typeof shard !== 'object' || Array.isArray(shard)) {
      throw new Error('object store photo overlay contains an invalid shard.')
    }
    const digest = String(shard.object_sha256 || '').toLowerCase()
    const objectKey = normalizedKey(shard.object_key)
    const shardCount = Number(shard.photo_count)
    if (!validSha256(digest) || objectKey !== expectedShardedObjectKey(bucket, digest, manifest) || !Number.isInteger(shardCount) || shardCount < 1) {
      throw new Error(`object store photo overlay shard ${bucket} identity is invalid.`)
    }
    shards[bucket] = { ...shard, objectKey, objectSha256: digest, photoCount: shardCount, overlayVersion }
    shardPhotoCount += shardCount
  }
  if (shardPhotoCount !== photoCount) throw new Error('object store photo overlay shard counts do not match its active pointer.')
  return {
    ...value,
    overlayVersion,
    photoCount,
    bucketCount,
    shards,
    hasPhoto
  }
}

async function loadActivePointer(manifest, manifestKey, { env = process.env, signal } = {}) {
  const key = overlayActiveKey(env)
  if (!key) return null
  const ttl = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_TTL_MS, DEFAULT_TTL_MS, 5_000, 10 * 60_000)
  const cacheKey = `${key}:${manifestKey || ''}`
  const cached = ACTIVE_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < ttl) return cached.value
  const existing = ACTIVE_IN_FLIGHT.get(cacheKey)
  if (existing?.env === env) return existing.promise

  const promise = (async () => {
    const body = await downloadSearchObject(key, {
      env,
      signal,
      maxBytes: integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_ACTIVE_BYTES, DEFAULT_MAX_ACTIVE_BYTES, 64 * 1024, 8 * 1024 * 1024),
      missingOk: true
    })
    if (body === null) {
      cacheActivePointer(cacheKey, null)
      return null
    }
    const value = validateActive(JSON.parse(body.toString('utf8')), manifest, manifestKey)
    cacheActivePointer(cacheKey, value)
    return value
  })()
  ACTIVE_IN_FLIGHT.set(cacheKey, { env, promise })
  try {
    return await promise
  } finally {
    if (ACTIVE_IN_FLIGHT.get(cacheKey)?.promise === promise) ACTIVE_IN_FLIGHT.delete(cacheKey)
  }
}

async function loadPhotoObject({ objectKey, objectSha256, photoCount, overlayVersion }, { env = process.env, signal } = {}) {
  const key = objectKey
  const cached = OBJECT_CACHE.get(key)
  if (cached) {
    OBJECT_CACHE.delete(key)
    OBJECT_CACHE.set(key, cached)
    return cached.photos
  }
  const existing = OBJECT_IN_FLIGHT.get(key)
  if (existing?.env === env) return existing.promise

  const promise = (async () => {
    const compressed = await downloadSearchObject(key, {
      env,
      signal,
      maxBytes: integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_BYTES, DEFAULT_MAX_OBJECT_BYTES, 64 * 1024, 32 * 1024 * 1024)
    })
    const digest = createHash('sha256').update(compressed).digest('hex')
    if (digest !== objectSha256) throw new Error('object store photo overlay object checksum does not match its active pointer.')
    const raw = await decompress(compressed)
    const maxDecodedBytes = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_DECODED_BYTES, DEFAULT_MAX_DECODED_BYTES, 1024 * 1024, 256 * 1024 * 1024)
    if (raw.length > maxDecodedBytes) throw new Error('object store photo overlay decoded payload exceeds the runtime budget.')
    const payload = JSON.parse(raw.toString('utf8'))
    if (!Array.isArray(payload) || Number(payload[0]) !== overlayVersion || !Array.isArray(payload[1])) {
      throw new Error('object store photo overlay payload is invalid.')
    }
    const photos = new Map()
    for (const entry of payload[1]) {
      if (!Array.isArray(entry) || entry.length !== 2 || !String(entry[0] || '').trim()) throw new Error('object store photo overlay contains an invalid location entry.')
      const photo = entry[1]
      if (!Array.isArray(photo) || !validSha256(photo[0])) throw new Error('object store photo overlay contains an invalid photo reference.')
      photos.set(String(entry[0]), photo)
    }
    if (photos.size !== photoCount) throw new Error('object store photo overlay count does not match its active pointer.')
    // A fixed object count makes large overlays consume unbounded memory and
    // tiny overlays thrash. Bound retained payload bytes instead.
    const bytes = raw.length + compressed.length
    const cacheLimit = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_CACHE_BYTES, PHOTO_OBJECT_CACHE_BYTES, 1024 * 1024, 64 * 1024 * 1024)
    if (bytes <= cacheLimit / 2) {
      photoObjectCacheBytes -= OBJECT_CACHE.get(key)?.bytes || 0
      OBJECT_CACHE.delete(key)
      OBJECT_CACHE.set(key, { photos, bytes })
      photoObjectCacheBytes += bytes
      while (photoObjectCacheBytes > cacheLimit && OBJECT_CACHE.size) {
        const oldest = OBJECT_CACHE.keys().next().value
        photoObjectCacheBytes -= OBJECT_CACHE.get(oldest).bytes
        OBJECT_CACHE.delete(oldest)
      }
    }
    return photos
  })()
  OBJECT_IN_FLIGHT.set(key, { env, promise })
  try {
    return await promise
  } finally {
    if (OBJECT_IN_FLIGHT.get(key)?.promise === promise) OBJECT_IN_FLIGHT.delete(key)
  }
}

async function mapConcurrent(values, limit, worker) {
  const output = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index], index)
    }
  })
  await Promise.all(runners)
  return output
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

export async function getPhotoSearchOverlay({ manifest, manifestKey, ids = [], env = process.env, signal } = {}) {
  const active = await loadActivePointer(manifest, manifestKey, { env, signal })
  if (!active) return null
  const requested = [...new Set((ids || []).map((value) => String(value || '').trim()).filter(Boolean))]
  const possible = requested.filter(active.hasPhoto)
  if (!possible.length || active.photoCount === 0) {
    return { active: true, hasPhoto: active.hasPhoto, photos: new Map(), possibleCount: possible.length, matchedCount: 0, photoCount: active.photoCount }
  }
  const buckets = new Map()
  for (const id of possible) {
    const bucket = photoBucket(id, active.bucketCount)
    if (!active.shards[bucket]) continue
    const idsForBucket = buckets.get(bucket) || []
    idsForBucket.push(id)
    buckets.set(bucket, idsForBucket)
  }
  const loaded = await mapConcurrent([...buckets.keys()], 16, async (bucket) => {
    const photos = await loadPhotoObject(active.shards[bucket], { env, signal })
    return { bucket, photos }
  })
  const photos = new Map()
  for (const { bucket, photos: shardPhotos } of loaded) {
    for (const id of buckets.get(bucket) || []) {
      const photo = shardPhotos.get(id)
      if (photo) photos.set(id, photo)
    }
  }
  if (photos.size !== possible.length) throw new Error('Photo membership disagrees with its metadata shards.')
  return { active: true, photos, possibleCount: possible.length, matchedCount: photos.size, photoCount: active.photoCount }
}

export function clearPhotoSearchOverlayCaches() {
  ACTIVE_CACHE.clear()
  ACTIVE_IN_FLIGHT.clear()
  OBJECT_CACHE.clear()
  OBJECT_IN_FLIGHT.clear()
  photoObjectCacheBytes = 0
}
