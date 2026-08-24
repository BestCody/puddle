import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { downloadB2SearchObject } from './b2-search-object-store.js'
import { locationSearchRuntimeConfig } from './location-search-shards.js'

const decompressZstd = promisify(zstdDecompress)
const PROJECTION_VERSION = 1
const MISSING_READY_TTL_MS = 15_000
const READY_CACHE = new Map()

export const TEXT_CORE_INDEX = Object.freeze({
  ID: 0,
  NAME: 1,
  ALIASES: 2,
  CATEGORY: 3,
  LATITUDE: 4,
  LONGITUDE: 5,
  CITY: 6,
  NEIGHBORHOOD: 7,
  ADDRESS: 8,
  PRICE_LEVEL: 9,
  AMENITIES: 10,
  ACCESSIBLE: 11,
  QUALITY_SCORE: 12,
  POPULARITY_SCORE: 13,
  PHOTO_HASH: 14,
  STATUS: 15,
  NORMALIZED_NAME: 16,
  NORMALIZED_ALIASES: 17,
  NORMALIZED_CATEGORY: 18,
  NORMALIZED_CITY: 19,
  NORMALIZED_NEIGHBORHOOD: 20,
  NORMALIZED_ADDRESS: 21
})

export const DETAIL_INDEX = Object.freeze({
  ID: 0,
  SLUG: 1,
  NAME: 2,
  ALIASES: 3,
  SUMMARY: 4,
  DESCRIPTION: 5,
  CATEGORY: 6,
  SUBCATEGORY: 7,
  LATITUDE: 8,
  LONGITUDE: 9,
  COUNTRY: 10,
  COUNTRY_CODE: 11,
  REGION: 12,
  REGION_CODE: 13,
  CITY: 14,
  NEIGHBORHOOD: 15,
  POSTAL_CODE: 16,
  ADDRESS: 17,
  TIMEZONE: 18,
  TIMEZONE_VERIFIED: 19,
  OPENING_HOURS: 20,
  PRICE_LEVEL: 21,
  AMENITIES: 22,
  ACCESSIBILITY: 23,
  ACCESSIBLE: 24,
  WEBSITE_URL: 25,
  PHONE_PUBLIC: 26,
  BRAND_ID: 27,
  BRAND_NAME: 28,
  SOURCE_PARENT_PLACE_ID: 29,
  DUPLICATE_GROUP_KEY: 30,
  CATALOGUE_GROUP_KEY: 31,
  QUALITY_SCORE: 32,
  POPULARITY_SCORE: 33,
  GOOGLE_PLACE_ID: 34,
  GOOGLE_PLACE_MATCH_SCORE: 35,
  STATUS: 36,
  UPDATED_AT: 37,
  PRIMARY_PHOTO: 38
})

function integer(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)))
}

function plannerId(manifest) {
  const value = String(manifest?.planner?.id || '').trim()
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : ''
}

function projectionBase(manifest) {
  const prefix = String(manifest?.prefix || '').trim().replace(/\/+$/, '')
  const id = plannerId(manifest)
  if (!prefix || !id) return ''
  return `${prefix}/text-projection-v${PROJECTION_VERSION}/${id}`
}

function projectionDigest(geoKey) {
  return createHash('sha256').update(String(geoKey || '')).digest('hex')
}

export function textProjectionReadyKey(manifest, env = process.env) {
  const override = String(env.GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY || '').trim().replace(/^\/+/, '')
  if (override) return override
  const base = projectionBase(manifest)
  return base ? `${base}/ready.json` : ''
}

export function textProjectionCoreKey(manifest, geoKey) {
  const base = projectionBase(manifest)
  return base ? `${base}/core/${projectionDigest(geoKey)}.json.zst` : ''
}

export function textProjectionDetailKey(manifest, geoKey, chunkIndex) {
  const base = projectionBase(manifest)
  const index = Math.max(0, Math.trunc(Number(chunkIndex) || 0))
  return base ? `${base}/detail/${projectionDigest(geoKey)}/${String(index).padStart(5, '0')}.json.zst` : ''
}

function projectionEnabled(env) {
  return String(env.GLOBAL_LOCATION_TEXT_PROJECTION || '1').trim() !== '0'
}

async function parseJsonObject(key, { env, fetchFn, signal, missingOk = false, maxBytes = 1024 * 1024 } = {}) {
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk, maxBytes })
  if (body === null) return null
  return JSON.parse(body.toString('utf8'))
}

async function loadProjectionReady(manifest, manifestKey, { env, fetchFn, signal } = {}) {
  if (!projectionEnabled(env)) return null
  const key = textProjectionReadyKey(manifest, env)
  if (!key) return null
  const cacheKey = `${manifestKey || ''}:${key}`
  const cached = READY_CACHE.get(cacheKey)
  if (cached && (cached.value || Date.now() - cached.at < MISSING_READY_TTL_MS)) return cached.value

  const value = await parseJsonObject(key, { env, fetchFn, signal, missingOk: true })
  if (!value) {
    READY_CACHE.set(cacheKey, { at: Date.now(), value: null })
    return null
  }
  if (
    Number(value.schema_version) !== 1 ||
    Number(value.projection_version) !== PROJECTION_VERSION ||
    String(value.source_manifest_key || '') !== String(manifestKey || '') ||
    String(value.planner_id || '') !== plannerId(manifest) ||
    !Number.isInteger(Number(value.detail_chunk_size)) || Number(value.detail_chunk_size) < 64
  ) {
    throw new Error('B2 text projection readiness metadata does not match the active search manifest.')
  }
  READY_CACHE.set(cacheKey, { at: Date.now(), value })
  return value
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      output[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, run))
  return output
}

async function fetchProjectionPayload(key, { env, fetchFn, signal } = {}) {
  const maxBytes = integer(env.GLOBAL_LOCATION_MAX_OBJECT_BYTES, 16 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024)
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk: true, maxBytes })
  if (body === null) return null
  const raw = await decompressZstd(body)
  const maxDecodedBytes = integer(env.GLOBAL_LOCATION_MAX_DECODED_OBJECT_BYTES, 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024)
  if (raw.length > maxDecodedBytes) throw new Error(`Decoded text projection ${key} exceeds the runtime object budget.`)
  return JSON.parse(raw.toString('utf8'))
}

export async function fetchTextProjectionCore(plan, { manifest, manifestKey, env = process.env, fetchFn = fetch, signal } = {}) {
  const ready = await loadProjectionReady(manifest, manifestKey, { env, fetchFn, signal })
  if (!ready) return null
  const config = locationSearchRuntimeConfig(env)
  const packs = await mapConcurrent(plan.shards, config.fetchConcurrency, async (shard) => {
    const key = textProjectionCoreKey(manifest, shard.key)
    if (!key) throw new Error('B2 text projection cannot resolve a core key for the active manifest.')
    const payload = await fetchProjectionPayload(key, { env, fetchFn, signal })
    // A missing core while the projection marker is present is a broken derivative:
    // fail loudly instead of silently degrading the search to a full pack scan.
    if (!payload) throw new Error(`B2 text projection core is missing: ${key}`)
    if (!Array.isArray(payload) || Number(payload[0]) !== PROJECTION_VERSION || !Array.isArray(payload[1])) {
      throw new Error(`Invalid B2 text projection core ${key}.`)
    }
    return { sourceKey: shard.key, rows: payload[1] }
  })
  const totalRows = packs.reduce((sum, pack) => sum + pack.rows.length, 0)
  if (totalRows > config.maxCandidates) throw new RangeError(`Decoded text projection produced ${totalRows} candidates; budget is ${config.maxCandidates}.`)
  return { ready, packs, totalRows }
}

export async function fetchTextProjectionDetailChunk(manifest, geoKey, chunkIndex, { env = process.env, fetchFn = fetch, signal } = {}) {
  const key = textProjectionDetailKey(manifest, geoKey, chunkIndex)
  const payload = await fetchProjectionPayload(key, { env, fetchFn, signal })
  if (!payload || !Array.isArray(payload) || Number(payload[0]) !== PROJECTION_VERSION || !Number.isInteger(Number(payload[1])) || !Array.isArray(payload[2])) {
    throw new Error(`Invalid B2 text projection detail ${key}.`)
  }
  return { start: Number(payload[1]), rows: payload[2] }
}

export function materializeDetailRow(row) {
  const p = DETAIL_INDEX
  const photo = Array.isArray(row[p.PRIMARY_PHOTO]) ? row[p.PRIMARY_PHOTO] : null
  const document = {
    id: row[p.ID],
    slug: row[p.SLUG],
    name: row[p.NAME],
    aliases: Array.isArray(row[p.ALIASES]) ? row[p.ALIASES] : [],
    summary: row[p.SUMMARY],
    description: row[p.DESCRIPTION],
    category: row[p.CATEGORY],
    subcategory: row[p.SUBCATEGORY],
    location: { lat: row[p.LATITUDE], lon: row[p.LONGITUDE] },
    latitude: row[p.LATITUDE],
    longitude: row[p.LONGITUDE],
    country: row[p.COUNTRY],
    country_code: row[p.COUNTRY_CODE],
    region: row[p.REGION],
    region_code: row[p.REGION_CODE],
    city: row[p.CITY],
    neighborhood: row[p.NEIGHBORHOOD],
    postal_code: row[p.POSTAL_CODE],
    address: row[p.ADDRESS],
    timezone: row[p.TIMEZONE],
    timezone_verified: Boolean(row[p.TIMEZONE_VERIFIED]),
    opening_hours: row[p.OPENING_HOURS] && typeof row[p.OPENING_HOURS] === 'object' ? row[p.OPENING_HOURS] : {},
    price_level: row[p.PRICE_LEVEL],
    amenities: Array.isArray(row[p.AMENITIES]) ? row[p.AMENITIES] : [],
    accessibility: row[p.ACCESSIBILITY] && typeof row[p.ACCESSIBILITY] === 'object' ? row[p.ACCESSIBILITY] : {},
    accessible: Boolean(row[p.ACCESSIBLE]),
    website_url: row[p.WEBSITE_URL],
    phone_public: row[p.PHONE_PUBLIC],
    brand_id: row[p.BRAND_ID],
    brand_name: row[p.BRAND_NAME],
    source_parent_place_id: row[p.SOURCE_PARENT_PLACE_ID],
    duplicate_group_key: row[p.DUPLICATE_GROUP_KEY],
    catalogue_group_key: row[p.CATALOGUE_GROUP_KEY],
    quality_score: Number(row[p.QUALITY_SCORE] || 0),
    popularity_score: Number(row[p.POPULARITY_SCORE] || 0),
    google_place_id: row[p.GOOGLE_PLACE_ID],
    google_place_match_score: row[p.GOOGLE_PLACE_MATCH_SCORE],
    status: row[p.STATUS],
    updated_at: row[p.UPDATED_AT]
  }
  if (photo?.[0]) {
    document.primary_photo = {
      content_hash: photo[0],
      provider: photo[1],
      attribution: photo[2],
      attribution_url: photo[3],
      license: photo[4],
      width: photo[5],
      height: photo[6]
    }
  }
  return document
}

export async function hydrateTextProjectionWinners(refs, { manifest, ready, env = process.env, fetchFn = fetch, signal } = {}) {
  if (!refs.length) return []
  const chunkSize = Math.trunc(Number(ready?.detail_chunk_size) || 0)
  if (chunkSize < 64) throw new Error('B2 text projection detail chunk size is invalid.')
  const groups = new Map()
  for (let outputIndex = 0; outputIndex < refs.length; outputIndex += 1) {
    const ref = refs[outputIndex]
    const rowIndex = Math.trunc(Number(ref?.rowIndex))
    if (!ref?.sourceKey || rowIndex < 0) throw new Error('B2 text projection winner reference is invalid.')
    const chunkIndex = Math.floor(rowIndex / chunkSize)
    const key = textProjectionDetailKey(manifest, ref.sourceKey, chunkIndex)
    const group = groups.get(key) || { key, chunkIndex, entries: [] }
    group.entries.push({ outputIndex, rowIndex })
    groups.set(key, group)
  }
  const config = locationSearchRuntimeConfig(env)
  const groupList = [...groups.values()]
  const payloads = await mapConcurrent(groupList, config.fetchConcurrency, async (group) => {
    const payload = await fetchProjectionPayload(group.key, { env, fetchFn, signal })
    if (!payload || !Array.isArray(payload) || Number(payload[0]) !== PROJECTION_VERSION || !Number.isInteger(Number(payload[1])) || !Array.isArray(payload[2])) {
      throw new Error(`Invalid B2 text projection detail ${group.key}.`)
    }
    return payload
  })
  const output = new Array(refs.length)
  for (let groupIndex = 0; groupIndex < groupList.length; groupIndex += 1) {
    const group = groupList[groupIndex]
    const payload = payloads[groupIndex]
    const start = Number(payload[1])
    const rows = payload[2]
    for (const entry of group.entries) {
      const detail = rows[entry.rowIndex - start]
      if (!Array.isArray(detail)) throw new Error(`B2 text projection detail row is missing for ${group.key}.`)
      output[entry.outputIndex] = materializeDetailRow(detail)
    }
  }
  return output
}

export function clearTextProjectionCaches() {
  READY_CACHE.clear()
}
