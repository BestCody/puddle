import {
  fetchCoarseViewportDocuments,
  fetchGeoShardDocuments,
  getActiveSearchManifest,
  getLocationBySlugFromShards,
  getLocationsByIdsFromShards,
  locationSearchRuntimeConfig,
  pointInBounds,
  radiusBoundingBox,
  resolveGeoShardPlan
} from './location-search-shards.js'
import { createTopK, prepareTextQuery, rankingWeights, scoreLocation, scoreTextMatch } from './location-search-ranking.js'
import { isB2Configured } from '../storage/b2-native.js'

const TO_RADIANS = Math.PI / 180
const EARTH_DIAMETER_METERS = 12_742_008.8

function text(value, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function finiteCoordinate(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`)
  return number
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function prepareHaversineOrigin(latitude, longitude) {
  const phi = latitude * TO_RADIANS
  return { phi, lambda: longitude * TO_RADIANS, cosPhi: Math.cos(phi) }
}

// Exact Haversine with request-invariant origin terms precomputed once.
function haversineDistanceMetersFromOrigin(origin, latitude, longitude) {
  const phi = Number(latitude) * TO_RADIANS
  const dPhi = phi - origin.phi
  const dLambda = Number(longitude) * TO_RADIANS - origin.lambda
  const sinPhi = Math.sin(dPhi * 0.5)
  const sinLambda = Math.sin(dLambda * 0.5)
  const a = sinPhi * sinPhi + origin.cosPhi * Math.cos(phi) * sinLambda * sinLambda
  return EARTH_DIAMETER_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

export function b2GlobalLocationSearchConfig(env = process.env) {
  const runtime = locationSearchRuntimeConfig(env)
  return { ...runtime, backend: 'b2', index: 'b2-active', configured: isB2Configured('B2_DATA', env) }
}

export function isB2GlobalLocationSearchConfigured(env = process.env) {
  return b2GlobalLocationSearchConfig(env).configured
}

export function normalizeGlobalLocationViewport({ north, south, east, west, zoom } = {}) {
  const normalized = {
    north: finiteCoordinate(north, 'north', -90, 90),
    south: finiteCoordinate(south, 'south', -90, 90),
    east: finiteCoordinate(east, 'east', -180, 180),
    west: finiteCoordinate(west, 'west', -180, 180),
    zoom: Number(zoom)
  }
  if (normalized.north <= normalized.south) throw new RangeError('north must be greater than south.')
  if (!Number.isFinite(normalized.zoom)) normalized.zoom = 11
  normalized.zoom = Math.max(0, Math.min(22, normalized.zoom))
  return normalized
}

export function viewportLocationLimit(zoom) {
  const level = Number(zoom)
  if (!Number.isFinite(level) || level < 6) return 80
  if (level < 9) return 100
  if (level < 12) return 120
  if (level < 15) return 150
  return 180
}

function published(row) {
  return String(row?.status || '') === 'published'
}

function prepareStructuredFilters(filters = {}) {
  const price = /^[1-4]$/.test(String(filters.price || '')) ? Number(filters.price) : null
  return {
    category: text(filters.category, 80),
    price,
    amenity: text(filters.amenity, 100).toLowerCase(),
    accessible: Boolean(filters.accessible)
  }
}

function matchesStructuredFilters(row, filters) {
  if (filters.category && String(row.category || '') !== filters.category) return false
  if (filters.price !== null && Number(row.price_level) !== filters.price) return false
  if (filters.amenity) {
    const amenities = Array.isArray(row.amenities) ? row.amenities : []
    if (!amenities.some((value) => String(value || '').toLowerCase() === filters.amenity)) return false
  }
  if (filters.accessible && !row.accessible) return false
  return true
}

function searchIndexLabel(active, manifest) {
  return `b2:${active?.snapshot || manifest?.source_snapshot || manifest?.snapshot || 'active'}`
}

export async function searchB2GlobalLocations({
  latitude,
  longitude,
  distanceKm,
  filters = {},
  excludeIds = [],
  preferredCategories = [],
  candidateLimit
} = {}, { env = process.env, fetchFn = fetch } = {}) {
  const started = performance.now()
  const config = locationSearchRuntimeConfig(env)
  const lat = finiteCoordinate(latitude, 'latitude', -90, 90)
  const lon = finiteCoordinate(longitude, 'longitude', -180, 180)
  const distance = Number(distanceKm)
  if (!Number.isFinite(distance) || distance <= 0) throw new RangeError('Global location search requires a positive distance.')
  if (distance > config.maxRadiusKm) throw new RangeError(`Global location search radius is capped at ${config.maxRadiusKm} km.`)
  const limit = integer(candidateLimit, config.candidateLimit, 1, 1000)
  const signal = AbortSignal.timeout(config.timeoutMs)
  const { active, manifest } = await getActiveSearchManifest({ env, fetchFn, signal })
  const bounds = radiusBoundingBox(lat, lon, distance)
  const plan = await resolveGeoShardPlan(bounds, { env, fetchFn, signal, manifest })
  const documents = await fetchGeoShardDocuments(plan, { env, fetchFn, signal })

  const excluded = new Set((excludeIds || []).map(String).filter(Boolean).slice(0, 10_000))
  const preferred = new Set((preferredCategories || []).map((value) => text(value, 80)).filter(Boolean).slice(0, 20))
  const structured = prepareStructuredFilters(filters)
  const query = prepareTextQuery(filters?.q)
  const weights = rankingWeights(env)
  const maxDistanceM = distance * 1000
  const distanceOrigin = prepareHaversineOrigin(lat, lon)
  const top = createTopK(limit)

  for (const row of documents) {
    if (!row?.id || !published(row) || excluded.has(String(row.id))) continue
    if (!pointInBounds(row.latitude, row.longitude, bounds) || !matchesStructuredFilters(row, structured)) continue
    const distanceM = haversineDistanceMetersFromOrigin(distanceOrigin, row.latitude, row.longitude)
    if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) continue
    const textScore = query.normalized ? scoreTextMatch(row, query) : 0
    if (query.normalized && textScore <= 0) continue
    const score = scoreLocation(row, { textScore, distanceM, maxDistanceM, preferredCategories: preferred, weights })
    top.push({ id: row.id, row, score, distanceM })
  }

  const candidates = top.values().map(({ row, score, distanceM }) => ({ ...row, distance_m: distanceM, search_score: score }))
  return {
    tookMs: Math.round((performance.now() - started) * 100) / 100,
    timedOut: false,
    candidates,
    candidateLimit: limit,
    index: searchIndexLabel(active, manifest),
    backend: 'b2',
    diagnostics: {
      routingTiles: plan.routingTiles,
      shards: plan.shards.length,
      compressedBytes: plan.compressedBytes,
      routedCandidates: plan.candidateCount,
      decodedCandidates: documents.length
    }
  }
}

export async function searchB2GlobalLocationsInViewport(input = {}, { env = process.env, fetchFn = fetch } = {}) {
  const started = performance.now()
  const bounds = normalizeGlobalLocationViewport(input)
  const limit = integer(input.candidateLimit, viewportLocationLimit(bounds.zoom), 1, 250)
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)
  const { active, manifest } = await getActiveSearchManifest({ env, fetchFn, signal })

  let documents = null
  let plan = null
  if (bounds.zoom < 8) documents = await fetchCoarseViewportDocuments(bounds, bounds.zoom, { env, fetchFn, signal, manifest })
  if (!documents) {
    plan = await resolveGeoShardPlan(bounds, { env, fetchFn, signal, manifest })
    documents = await fetchGeoShardDocuments(plan, { env, fetchFn, signal })
  }

  const weights = rankingWeights(env)
  const top = createTopK(limit)
  for (const row of documents) {
    if (!row?.id || !published(row) || !pointInBounds(row.latitude, row.longitude, bounds)) continue
    const score = scoreLocation(row, { weights })
    top.push({ id: row.id, row, score, distanceM: Number.POSITIVE_INFINITY })
  }
  const candidates = top.values().map(({ row, score }) => ({ ...row, distance_m: null, search_score: score }))
  return {
    tookMs: Math.round((performance.now() - started) * 100) / 100,
    timedOut: false,
    candidates,
    candidateLimit: limit,
    index: searchIndexLabel(active, manifest),
    backend: 'b2',
    diagnostics: plan ? {
      routingTiles: plan.routingTiles,
      shards: plan.shards.length,
      compressedBytes: plan.compressedBytes,
      routedCandidates: plan.candidateCount,
      decodedCandidates: documents.length
    } : { coarse: true, decodedCandidates: documents.length }
  }
}

export async function getB2GlobalLocationsByIds(ids = [], { env = process.env, fetchFn = fetch } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)
  return getLocationsByIdsFromShards(ids, { env, fetchFn, signal })
}

export async function getB2GlobalLocationBySlug(slug, { env = process.env, fetchFn = fetch } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)
  return getLocationBySlugFromShards(slug, { env, fetchFn, signal })
}
