import { createHash } from 'node:crypto'
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { downloadB2SearchObject } from './b2-search-object-store.js'

const decompress = promisify(brotliDecompress)
const DEFAULT_ACTIVE_KEY = 'data/search/active.json'
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024
const DEFAULT_MANIFEST_TTL_MS = 60_000
const JSON_CACHE = new Map()
const RADIUS_QUERY_BY_BOUNDS = new WeakMap()
let jsonCacheBytes = 0
let manifestCache = null

function integer(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(number)))
}

function number(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function cacheLimit(env) {
  return integer(env.GLOBAL_LOCATION_CACHE_BYTES, DEFAULT_CACHE_BYTES, 4 * 1024 * 1024, 512 * 1024 * 1024)
}

function cacheGet(key) {
  const entry = JSON_CACHE.get(key)
  if (!entry) return null
  JSON_CACHE.delete(key)
  JSON_CACHE.set(key, entry)
  return entry.value
}

function cacheSet(key, value, bytes, env) {
  const size = Math.max(1, Number(bytes) || 1)
  const limit = cacheLimit(env)
  if (size > limit / 2) return
  const existing = JSON_CACHE.get(key)
  if (existing) jsonCacheBytes -= existing.bytes
  JSON_CACHE.delete(key)
  JSON_CACHE.set(key, { value, bytes: size })
  jsonCacheBytes += size
  while (jsonCacheBytes > limit && JSON_CACHE.size) {
    const oldestKey = JSON_CACHE.keys().next().value
    const oldest = JSON_CACHE.get(oldestKey)
    JSON_CACHE.delete(oldestKey)
    jsonCacheBytes -= oldest?.bytes || 0
  }
}

async function parseObject(key, { compressed = key.endsWith('.br'), missingOk = false, cacheable = true, env = process.env, fetchFn = fetch, signal } = {}) {
  const cached = cacheable ? cacheGet(key) : null
  if (cached !== null) return cached
  const maxObjectBytes = integer(env.GLOBAL_LOCATION_MAX_OBJECT_BYTES, 4 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024)
  const body = await downloadB2SearchObject(key, {
    env,
    fetchFn,
    maxBytes: maxObjectBytes,
    signal,
    missingOk
  })
  if (body === null) return null
  const raw = compressed ? await decompress(body) : body
  const maxDecodedBytes = integer(env.GLOBAL_LOCATION_MAX_DECODED_OBJECT_BYTES, 48 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024)
  if (raw.length > maxDecodedBytes) throw new Error(`Decoded search object ${key} exceeds the runtime object budget.`)
  const value = JSON.parse(raw.toString('utf8'))
  if (cacheable) cacheSet(key, value, body.length + raw.length, env)
  return value
}

export function locationSearchRuntimeConfig(env = process.env) {
  return {
    activeKey: String(env.GLOBAL_LOCATION_SEARCH_MANIFEST_KEY || DEFAULT_ACTIVE_KEY).trim().replace(/^\/+/, ''),
    timeoutMs: integer(env.GLOBAL_LOCATION_SEARCH_TIMEOUT_MS, 12_000, 10_000, 15_000),
    candidateLimit: integer(env.GLOBAL_LOCATION_CANDIDATE_LIMIT, 500, 50, 1000),
    maxRadiusKm: number(env.GLOBAL_LOCATION_MAX_RADIUS_KM, 100, 1, 1000),
    maxDirectoryTiles: integer(env.GLOBAL_LOCATION_MAX_DIRECTORY_TILES, 64, 4, 512),
    maxShards: integer(env.GLOBAL_LOCATION_MAX_SHARDS, 128, 4, 512),
    maxCompressedBytes: integer(env.GLOBAL_LOCATION_MAX_COMPRESSED_BYTES, 16 * 1024 * 1024, 512 * 1024, 128 * 1024 * 1024),
    maxCandidates: integer(env.GLOBAL_LOCATION_MAX_CANDIDATES, 150_000, 5_000, 1_000_000),
    fetchConcurrency: integer(env.GLOBAL_LOCATION_FETCH_CONCURRENCY, 16, 1, 24)
  }
}

export async function getActiveSearchManifest({ env = process.env, fetchFn = fetch, signal } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const ttl = integer(env.GLOBAL_LOCATION_MANIFEST_TTL_MS, DEFAULT_MANIFEST_TTL_MS, 5_000, 10 * 60_000)
  if (manifestCache?.key === config.activeKey && Date.now() - manifestCache.at < ttl) return manifestCache.value
  const active = await parseObject(config.activeKey, { compressed: false, cacheable: false, env, fetchFn, signal })
  const manifestKey = String(active?.manifest_key || active?.manifestKey || '').trim()
  if (!manifestKey) throw new Error('B2 search active pointer does not contain manifest_key.')
  const manifest = await parseObject(manifestKey, { compressed: manifestKey.endsWith('.br'), env, fetchFn, signal })
  if (Number(manifest?.schema_version) !== 1) throw new Error(`Unsupported B2 search schema version ${manifest?.schema_version}.`)
  const value = { active, manifest, manifestKey }
  manifestCache = { key: config.activeKey, at: Date.now(), value }
  return value
}

function wrapLongitude(value) {
  let result = Number(value)
  while (result > 180) result -= 360
  while (result < -180) result += 360
  return result
}

function rememberRadiusQuery(bounds, latitude, longitude, distanceKm) {
  RADIUS_QUERY_BY_BOUNDS.set(bounds, {
    latitude: Number(latitude),
    longitude: wrapLongitude(longitude),
    distanceKm: Number(distanceKm)
  })
  return bounds
}

export function radiusBoundingBox(latitude, longitude, distanceKm) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  const radius = Number(distanceKm)
  const latDelta = radius / 110.574
  const north = Math.min(90, lat + latDelta)
  const south = Math.max(-90, lat - latDelta)
  if (north >= 89.999 || south <= -89.999) {
    return rememberRadiusQuery({ north, south, west: -180, east: 180 }, lat, lon, radius)
  }
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  const lonDelta = Math.min(180, radius / (111.320 * cos))
  if (lonDelta >= 180) {
    return rememberRadiusQuery({ north, south, west: -180, east: 180 }, lat, lon, radius)
  }
  return rememberRadiusQuery(
    { north, south, west: wrapLongitude(lon - lonDelta), east: wrapLongitude(lon + lonDelta) },
    lat,
    lon,
    radius
  )
}

function longitudeRanges(west, east) {
  if (west <= east) return [[west, east]]
  return [[west, 180], [-180, east]]
}

function directoryIndex(value, offset, size, maxIndex) {
  return Math.max(0, Math.min(maxIndex, Math.floor((value + offset) / size)))
}

export function directoryTilesForBounds(bounds, tileDegrees = 1) {
  const size = Math.max(0.25, Math.min(10, Number(tileDegrees) || 1))
  const latCount = Math.ceil(180 / size)
  const lonCount = Math.ceil(360 / size)
  const southIndex = directoryIndex(Math.max(-90, bounds.south), 90, size, latCount - 1)
  const northValue = Math.min(89.999999, bounds.north)
  const northIndex = directoryIndex(northValue, 90, size, latCount - 1)
  const result = []
  for (const [west, east] of longitudeRanges(bounds.west, bounds.east)) {
    const westIndex = directoryIndex(west, 180, size, lonCount - 1)
    const eastIndex = directoryIndex(Math.min(179.999999, east), 180, size, lonCount - 1)
    for (let latIndex = southIndex; latIndex <= northIndex; latIndex += 1) {
      for (let lonIndex = westIndex; lonIndex <= eastIndex; lonIndex += 1) result.push([latIndex, lonIndex])
    }
  }
  return result
}

function longitudeOverlap(aWest, aEast, bWest, bEast) {
  for (const [aw, ae] of longitudeRanges(aWest, aEast)) {
    for (const [bw, be] of longitudeRanges(bWest, bEast)) if (aw <= be && bw <= ae) return true
  }
  return false
}

export function boundsOverlap(left, right) {
  return left.south <= right.north && right.south <= left.north && longitudeOverlap(left.west, left.east, right.west, right.east)
}

function normalizeLongitudeDeltaDegrees(value) {
  let delta = Number(value)
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

function minimumDistanceToBoundsMeters(latitude, longitude, bounds) {
  const lat = Number(latitude)
  const lon = wrapLongitude(longitude)
  const south = Number(bounds.south)
  const north = Number(bounds.north)
  const west = Number(bounds.west)
  const east = Number(bounds.east)
  if (![lat, lon, south, north, west, east].every(Number.isFinite)) return 0
  if (pointInBounds(lat, lon, bounds)) return 0

  let minimum = Number.POSITIVE_INFINITY
  const evaluate = (candidateLat, candidateLon) => {
    const distance = haversineDistanceMeters(lat, lon, candidateLat, candidateLon)
    if (Number.isFinite(distance) && distance < minimum) minimum = distance
  }
  const toRadians = Math.PI / 180
  const phi = lat * toRadians

  for (const [rangeWest, rangeEast] of longitudeRanges(west, east)) {
    evaluate(south, rangeWest)
    evaluate(south, rangeEast)
    evaluate(north, rangeWest)
    evaluate(north, rangeEast)

    if (lon >= rangeWest && lon <= rangeEast) {
      evaluate(south, lon)
      evaluate(north, lon)
    }

    for (const edgeLon of [rangeWest, rangeEast]) {
      const deltaLambda = normalizeLongitudeDeltaDegrees(edgeLon - lon) * toRadians
      const footLatitude = Math.atan2(
        Math.sin(phi),
        Math.cos(phi) * Math.cos(deltaLambda)
      ) / toRadians
      if (footLatitude >= south && footLatitude <= north) evaluate(footLatitude, edgeLon)
    }
  }

  return Number.isFinite(minimum) ? minimum : 0
}

function boundsMayIntersectRadius(bounds, query) {
  const distanceKm = Number(query?.distanceKm)
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return true
  const minimumDistance = minimumDistanceToBoundsMeters(query.latitude, query.longitude, bounds)
  return minimumDistance <= distanceKm * 1000 + 1
}

function descriptorBounds(descriptor) {
  if (Array.isArray(descriptor)) return { north: Number(descriptor[2]), south: Number(descriptor[3]), east: Number(descriptor[4]), west: Number(descriptor[5]) }
  return {
    north: Number(descriptor.north), south: Number(descriptor.south), east: Number(descriptor.east), west: Number(descriptor.west)
  }
}

function descriptorKey(descriptor) {
  return Array.isArray(descriptor) ? String(descriptor[0]) : String(descriptor.key)
}

function descriptorCount(descriptor) {
  return Number(Array.isArray(descriptor) ? descriptor[6] : descriptor.count) || 0
}

function descriptorBytes(descriptor) {
  return Number(Array.isArray(descriptor) ? descriptor[7] : descriptor.compressed_bytes) || 0
}

async function mapConcurrent(values, limit, worker) {
  const output = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index], index)
    }
  })
  await Promise.all(runners)
  return output
}

function routeKey(prefix, latIndex, lonIndex) {
  return `${prefix}/${latIndex}/${lonIndex}.json.br`
}

export async function resolveGeoShardPlan(bounds, { env = process.env, fetchFn = fetch, signal, manifest } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const resolvedManifest = manifest || (await getActiveSearchManifest({ env, fetchFn, signal })).manifest
  const directory = resolvedManifest.geo?.directory || {}
  const tileDegrees = Number(directory.tile_degrees || 1)
  const prefix = String(directory.prefix || `${resolvedManifest.prefix || ''}/routing`).replace(/\/+$/, '')
  const tiles = directoryTilesForBounds(bounds, tileDegrees)
  if (tiles.length > config.maxDirectoryTiles) {
    throw new RangeError(`Location query intersects ${tiles.length} routing tiles; maximum is ${config.maxDirectoryTiles}.`)
  }

  const routeObjects = await mapConcurrent(tiles, config.fetchConcurrency, async ([latIndex, lonIndex]) => {
    return parseObject(routeKey(prefix, latIndex, lonIndex), { compressed: true, missingOk: true, env, fetchFn, signal })
  })

  const radiusQuery = RADIUS_QUERY_BY_BOUNDS.get(bounds)
  const eligible = new Map()
  for (const route of routeObjects) {
    if (!Array.isArray(route)) continue
    for (const descriptor of route) {
      const key = descriptorKey(descriptor)
      const shardBounds = descriptorBounds(descriptor)
      if (!key || !boundsOverlap(bounds, shardBounds)) continue
      if (radiusQuery && !boundsMayIntersectRadius(shardBounds, radiusQuery)) continue
      const bytes = descriptorBytes(descriptor)
      const count = descriptorCount(descriptor)
      const distanceMeters = radiusQuery
        ? minimumDistanceToBoundsMeters(radiusQuery.latitude, radiusQuery.longitude, shardBounds)
        : 0
      const existing = eligible.get(key)
      if (existing) {
        existing.distanceMeters = Math.min(existing.distanceMeters, distanceMeters)
        continue
      }
      eligible.set(key, { key, bytes, count, distanceMeters })
    }
  }

  if (radiusQuery) {
    const ordered = [...eligible.values()].sort((left, right) => left.distanceMeters - right.distanceMeters || left.key.localeCompare(right.key))
    const selected = []
    let compressedBytes = 0
    let candidateCount = 0
    let truncatedByBudget = false
    for (const shard of ordered) {
      const exceedsBudget =
        selected.length + 1 > config.maxShards ||
        compressedBytes + shard.bytes > config.maxCompressedBytes ||
        candidateCount + shard.count > config.maxCandidates
      if (exceedsBudget) {
        truncatedByBudget = true
        break
      }
      selected.push({ key: shard.key, bytes: shard.bytes, count: shard.count })
      compressedBytes += shard.bytes
      candidateCount += shard.count
    }
    if (!selected.length && ordered.length) {
      throw new RangeError('Nearest location shard exceeds the configured radius-query resource budget.')
    }
    return {
      shards: selected,
      compressedBytes,
      candidateCount,
      routingTiles: tiles.length,
      truncatedByBudget,
      eligibleShards: ordered.length
    }
  }

  const shards = [...eligible.values()].map(({ key, bytes, count }) => ({ key, bytes, count }))
  const compressedBytes = shards.reduce((total, shard) => total + shard.bytes, 0)
  const candidateCount = shards.reduce((total, shard) => total + shard.count, 0)
  if (shards.length > config.maxShards) throw new RangeError(`Location query requires ${shards.length} shards; maximum is ${config.maxShards}.`)
  if (compressedBytes > config.maxCompressedBytes) throw new RangeError(`Location query requires ${compressedBytes} compressed bytes; budget is ${config.maxCompressedBytes}.`)
  if (candidateCount > config.maxCandidates) throw new RangeError(`Location query touches ${candidateCount} candidates; budget is ${config.maxCandidates}.`)
  return { shards, compressedBytes, candidateCount, routingTiles: tiles.length }
}

export async function fetchGeoShardDocuments(plan, { env = process.env, fetchFn = fetch, signal } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const objects = await mapConcurrent(plan.shards, config.fetchConcurrency, ({ key }) => parseObject(key, { compressed: true, env, fetchFn, signal }))
  const documents = []
  for (const object of objects) {
    if (!Array.isArray(object)) throw new Error('Geo search shard must contain a JSON array.')
    documents.push(...object)
  }
  if (documents.length > config.maxCandidates) throw new RangeError(`Decoded location query produced ${documents.length} candidates; budget is ${config.maxCandidates}.`)
  return documents
}

function hashBucket(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 3)
}

function dataPrefix(manifest) {
  const prefix = String(manifest.prefix || '').replace(/\/+$/, '')
  if (!prefix) throw new Error('B2 search manifest does not define prefix.')
  return prefix
}

export async function getLocationsByIdsFromShards(ids, { env = process.env, fetchFn = fetch, signal, manifest } = {}) {
  const resolvedManifest = manifest || (await getActiveSearchManifest({ env, fetchFn, signal })).manifest
  const values = [...new Set((ids || []).map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 1000)
  if (!values.length) return []
  const groups = new Map()
  for (const id of values) {
    const bucket = hashBucket(id)
    const group = groups.get(bucket) || []
    group.push(id)
    groups.set(bucket, group)
  }
  const prefix = dataPrefix(resolvedManifest)
  const entries = [...groups.entries()]
  const config = locationSearchRuntimeConfig(env)
  const objects = await mapConcurrent(entries, config.fetchConcurrency, async ([bucket, group]) => {
    const object = await parseObject(`${prefix}/id/${bucket}.json.br`, { compressed: true, missingOk: true, env, fetchFn, signal })
    if (!object || typeof object !== 'object' || Array.isArray(object)) return []
    return group.map((id) => object[id]).filter(Boolean)
  })
  return objects.flat()
}

export async function getLocationBySlugFromShards(slug, { env = process.env, fetchFn = fetch, signal, manifest } = {}) {
  const safeSlug = String(slug || '').trim()
  if (!safeSlug) return null
  const resolvedManifest = manifest || (await getActiveSearchManifest({ env, fetchFn, signal })).manifest
  const prefix = dataPrefix(resolvedManifest)
  const bucket = hashBucket(safeSlug)
  const slugMap = await parseObject(`${prefix}/slug/${bucket}.json.br`, { compressed: true, missingOk: true, env, fetchFn, signal })
  const id = slugMap && typeof slugMap === 'object' ? slugMap[safeSlug] : null
  if (!id) return null
  const rows = await getLocationsByIdsFromShards([id], { env, fetchFn, signal, manifest: resolvedManifest })
  return rows[0] || null
}

function coarseTileRange(bounds, degrees) {
  return directoryTilesForBounds(bounds, degrees)
}

export async function fetchCoarseViewportDocuments(bounds, zoom, { env = process.env, fetchFn = fetch, signal, manifest } = {}) {
  const resolvedManifest = manifest || (await getActiveSearchManifest({ env, fetchFn, signal })).manifest
  const mapConfig = Number(zoom) < 5 ? resolvedManifest.geo_map?.z0 : resolvedManifest.geo_map?.z1
  if (!mapConfig) return null
  const degrees = Number(mapConfig.tile_degrees)
  const prefix = String(mapConfig.prefix || '').replace(/\/+$/, '')
  if (!prefix || !degrees) return null
  const tiles = coarseTileRange(bounds, degrees)
  const config = locationSearchRuntimeConfig(env)
  if (tiles.length > config.maxDirectoryTiles * 16) throw new RangeError('Viewport exceeds coarse-map routing budget.')
  const objects = await mapConcurrent(tiles, config.fetchConcurrency, ([latIndex, lonIndex]) => parseObject(`${prefix}/${latIndex}/${lonIndex}.json.br`, {
    compressed: true, missingOk: true, env, fetchFn, signal
  }))
  const byId = new Map()
  for (const object of objects) if (Array.isArray(object)) for (const row of object) if (row?.id && !byId.has(row.id)) byId.set(row.id, row)
  return [...byId.values()]
}

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRadians = Math.PI / 180
  const phi1 = Number(lat1) * toRadians
  const phi2 = Number(lat2) * toRadians
  const dPhi = (Number(lat2) - Number(lat1)) * toRadians
  const dLambda = (Number(lon2) - Number(lon1)) * toRadians
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 12_742_008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function pointInBounds(latitude, longitude, bounds) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < bounds.south || lat > bounds.north) return false
  if (bounds.west <= bounds.east) return lon >= bounds.west && lon <= bounds.east
  return lon >= bounds.west || lon <= bounds.east
}

export function clearLocationSearchCaches() {
  JSON_CACHE.clear()
  jsonCacheBytes = 0
  manifestCache = null
}