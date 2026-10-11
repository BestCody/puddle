import { createHash } from 'node:crypto'
import { downloadSearchObject } from './search-object-store.js'
import { getIndexedPhotos, clearIndexedLocationCaches } from './indexed-location-data.js'

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ACTIVE_BYTES = 8 * 1024 * 1024
const ACTIVE_CACHE = new Map()
const ACTIVE_IN_FLIGHT = new Map()

function normalizedKey(value) {
  return String(value || '').trim().replace(/^\/+/, '')
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback
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
    const identifier = String(id)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return false
    const hex = identifier.replaceAll('-', '')
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
  if (Number(value?.schema_version) !== 1 || Number(value?.overlay_version) !== 2) throw new Error('Photo overlay has an unsupported schema.')
  const snapshot = String(manifest?.source_snapshot || manifest?.snapshot || '')
  if (!snapshot || value.source_snapshot !== snapshot || value.source_manifest_key !== manifestKey) {
    throw new Error('Photo overlay is not aligned with the active search manifest.')
  }
  const photoCount = Number(value.photo_count)
  if (!Number.isInteger(photoCount) || photoCount < 0) throw new Error('Photo overlay photo_count is invalid.')
  if (Number(value.local_index?.schema_version) !== 1 || !/^[a-f0-9]{64}$/.test(String(value.local_index?.data_sha256 || ''))) {
    throw new Error('Photo overlay requires its completed local index.')
  }
  return { ...value, photoCount, hasPhoto: parseMembership(value.membership, photoCount) }
}

async function loadActivePointer(manifest, manifestKey, { env, signal }) {
  const prefix = normalizedKey(env.PUDDLE_DATA_PREFIX || 'data')
  const key = normalizedKey(env.GLOBAL_LOCATION_PHOTO_OVERLAY_ACTIVE_KEY || `${prefix}/search/photo-overlay-v1/active.json`)
  const cacheKey = `${key}:${manifestKey}`
  const cached = ACTIVE_CACHE.get(cacheKey)
  const ttl = integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_TTL_MS, DEFAULT_TTL_MS, 5_000, 10 * 60_000)
  if (cached?.env === env && Date.now() - cached.at < ttl) return cached.value
  const existing = ACTIVE_IN_FLIGHT.get(cacheKey)
  if (existing?.env === env) return existing.promise
  const promise = (async () => {
    const body = await downloadSearchObject(key, {
      env, signal, missingOk: true,
      maxBytes: integer(env.GLOBAL_LOCATION_PHOTO_OVERLAY_MAX_ACTIVE_BYTES, DEFAULT_MAX_ACTIVE_BYTES, 64 * 1024, 8 * 1024 * 1024)
    })
    const value = body === null ? null : validateActive(JSON.parse(body.toString('utf8')), manifest, manifestKey)
    ACTIVE_CACHE.delete(cacheKey)
    ACTIVE_CACHE.set(cacheKey, { at: Date.now(), env, value })
    while (ACTIVE_CACHE.size > 4) ACTIVE_CACHE.delete(ACTIVE_CACHE.keys().next().value)
    return value
  })()
  ACTIVE_IN_FLIGHT.set(cacheKey, { env, promise })
  try { return await promise } finally {
    if (ACTIVE_IN_FLIGHT.get(cacheKey)?.promise === promise) ACTIVE_IN_FLIGHT.delete(cacheKey)
  }
}

export function photoObjectFromOverlay(value) {
  if (!Array.isArray(value) || !/^[a-f0-9]{64}$/i.test(String(value[0] || ''))) return null
  return { content_hash: value[0].toLowerCase(), provider: value[1] || null,
    attribution: value[2] || null, attribution_url: value[3] || null,
    license: value[4] || null, width: value[5] ?? null, height: value[6] ?? null }
}

export async function getPhotoSearchOverlay({ manifest, manifestKey, ids = [], env = process.env, signal } = {}) {
  const active = await loadActivePointer(manifest, manifestKey, { env, signal })
  if (!active) return null
  const requested = [...new Set(ids.filter(Boolean).map(value => String(value).trim().toLowerCase()).filter(Boolean))]
  const possible = requested.filter(active.hasPhoto)
  const photos = possible.length ? getIndexedPhotos(active.local_index, possible, { manifestKey, photoCount: active.photoCount, env }) : new Map()
  if (photos.size !== possible.length || [...photos.values()].some(value => !photoObjectFromOverlay(value))) {
    throw new Error('Photo membership disagrees with its local metadata index.')
  }
  return { active: true, hasPhoto: active.hasPhoto, photos, possibleCount: possible.length,
    matchedCount: photos.size, photoCount: active.photoCount }
}

export function clearPhotoSearchOverlayCaches() {
  ACTIVE_CACHE.clear()
  ACTIVE_IN_FLIGHT.clear()
  clearIndexedLocationCaches()
}
