const DEFAULT_ZOOM = 10
const MAX_MERCATOR_LATITUDE = 85.05112878
const STATIC_SCHEMA_VERSION = 1

const PLACE_FIELDS = Object.freeze([
  'source', 'sourcePlaceId', 'name', 'slug', 'kind', 'latitude', 'longitude',
  'city', 'neighborhood', 'region', 'regionCode', 'country', 'countryCode',
  'postalCode', 'addressPublic', 'timezone', 'priceLevel', 'brandId', 'brandName',
  'duplicateGroupKey', 'catalogueGroupKey', 'summary', 'sourceParentPlaceId',
  'sourceUpdatedAt', 'sourceConfidence', 'sourceOperatingStatus', 'payloadHash',
  'categoryConfidence', 'normalizationVersion', 'categoryMappingVersion', 'amenities',
  'accessibility', 'openingHours', 'websiteUrl', 'phonePublic', 'sourceMetadata'
])

const PLACEHOLDER_CATEGORIES = Object.freeze([
  'cafe', 'restaurant', 'bar', 'park', 'museum', 'gallery', 'attraction',
  'activity_venue', 'study_spot', 'scenic_spot', 'nightlife', 'shop',
  'community_space', 'other'
])

function finite(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boundedLatitude(value) {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, finite(value, 0)))
}

function wrappedLongitude(value) {
  const longitude = finite(value, 0)
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

function rfc3986Segment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function staticCatalogueBaseUrl(value = process.env.STATIC_CATALOGUE_BASE_URL || process.env.NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) return null
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function catalogueManifestUrl(baseUrl = staticCatalogueBaseUrl()) {
  return baseUrl ? `${baseUrl}/catalogue/manifest.json` : null
}

export function categoryPlaceholderUrl(category, baseUrl = staticCatalogueBaseUrl()) {
  if (!baseUrl) return null
  const normalized = PLACEHOLDER_CATEGORIES.includes(String(category || '')) ? String(category) : 'other'
  return `${baseUrl}/catalogue/placeholders/${rfc3986Segment(normalized)}.svg`
}

export function lonLatToTile(longitude, latitude, zoom = DEFAULT_ZOOM) {
  const z = Math.max(0, Math.min(22, Math.trunc(finite(zoom, DEFAULT_ZOOM))))
  const scale = 2 ** z
  const lon = wrappedLongitude(longitude)
  const lat = boundedLatitude(latitude) * Math.PI / 180
  const x = Math.max(0, Math.min(scale - 1, Math.floor((lon + 180) / 360 * scale)))
  const y = Math.max(0, Math.min(scale - 1, Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale)))
  return { z, x, y }
}

function longitudeRanges(west, east) {
  const normalizedWest = wrappedLongitude(west)
  const normalizedEast = wrappedLongitude(east)
  if (east - west >= 360) return [[-180, 180 - Number.EPSILON]]
  return normalizedWest <= normalizedEast
    ? [[normalizedWest, normalizedEast]]
    : [[normalizedWest, 180 - Number.EPSILON], [-180, normalizedEast]]
}

export function boundingBoxForRadius(latitude, longitude, radiusKm) {
  const radius = Math.max(0.1, Math.min(250, finite(radiusKm, 25)))
  const lat = Math.max(-90, Math.min(90, finite(latitude, 0)))
  const lon = wrappedLongitude(longitude)
  const latDelta = radius / 111.32
  const cosine = Math.max(0.08, Math.cos(lat * Math.PI / 180))
  const lonDelta = Math.min(180, radius / (111.32 * cosine))
  return {
    south: Math.max(-MAX_MERCATOR_LATITUDE, lat - latDelta),
    north: Math.min(MAX_MERCATOR_LATITUDE, lat + latDelta),
    west: lon - lonDelta,
    east: lon + lonDelta
  }
}

export function tileCoordinatesForRadius(latitude, longitude, radiusKm, zoom = DEFAULT_ZOOM) {
  const bounds = boundingBoxForRadius(latitude, longitude, radiusKm)
  const coordinates = []
  const seen = new Set()
  for (const [west, east] of longitudeRanges(bounds.west, bounds.east)) {
    const northWest = lonLatToTile(west, bounds.north, zoom)
    const southEast = lonLatToTile(east, bounds.south, zoom)
    for (let x = northWest.x; x <= southEast.x; x += 1) {
      for (let y = northWest.y; y <= southEast.y; y += 1) {
        const key = `${northWest.z}/${x}/${y}`
        if (seen.has(key)) continue
        seen.add(key)
        coordinates.push({ z: northWest.z, x, y, key })
      }
    }
  }
  return coordinates
}

export function tileObjectKey(release, tile) {
  const version = String(release || '').trim()
  if (!version) throw new Error('Static catalogue release is missing.')
  return `catalogue/releases/${rfc3986Segment(version)}/tiles/${tile.z}/${tile.x}/${tile.y}.json`
}

export function packStaticPlace(item, source = 'overture') {
  const value = { ...item, source: item?.source || source }
  return PLACE_FIELDS.map((field) => value[field] ?? null)
}

export function unpackStaticPlace(record) {
  if (!Array.isArray(record) || record.length < 7) return null
  const item = Object.fromEntries(PLACE_FIELDS.map((field, index) => [field, record[index] ?? null]))
  item.latitude = finite(item.latitude)
  item.longitude = finite(item.longitude)
  if (!item.source || !item.sourcePlaceId || !item.name || !item.kind || item.latitude === null || item.longitude === null) return null
  item.priceLevel = Number.isInteger(Number(item.priceLevel)) ? Number(item.priceLevel) : null
  item.sourceConfidence = finite(item.sourceConfidence)
  item.categoryConfidence = finite(item.categoryConfidence)
  item.normalizationVersion = Math.max(1, Math.trunc(finite(item.normalizationVersion, 1)))
  item.categoryMappingVersion = Math.max(1, Math.trunc(finite(item.categoryMappingVersion, 1)))
  item.amenities = Array.isArray(item.amenities) ? item.amenities : []
  item.accessibility = item.accessibility && typeof item.accessibility === 'object' && !Array.isArray(item.accessibility) ? item.accessibility : {}
  item.openingHours = item.openingHours && typeof item.openingHours === 'object' && !Array.isArray(item.openingHours) ? item.openingHours : {}
  item.sourceMetadata = item.sourceMetadata && typeof item.sourceMetadata === 'object' && !Array.isArray(item.sourceMetadata) ? item.sourceMetadata : {}
  return item
}

export function haversineDistanceMeters(aLat, aLon, bLat, bLon) {
  if (![aLat, aLon, bLat, bLon].every((value) => Number.isFinite(Number(value)))) return null
  const radians = (value) => Number(value) * Math.PI / 180
  const deltaLat = radians(Number(bLat) - Number(aLat))
  const deltaLon = radians(Number(bLon) - Number(aLon))
  const first = radians(aLat)
  const second = radians(bLat)
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(first) * Math.cos(second) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)))
}

function validManifest(value) {
  return value && typeof value === 'object' && Number(value.schema) === STATIC_SCHEMA_VERSION && String(value.release || '').trim() && Number.isInteger(Number(value.zoom))
}

async function fetchJson(url, fetchImpl, options) {
  const response = await fetchImpl(url, options)
  if (!response.ok) {
    const error = new Error(`Static catalogue returned ${response.status}.`)
    error.status = response.status
    throw error
  }
  return response.json()
}

export async function fetchStaticCatalogueManifest({
  baseUrl = staticCatalogueBaseUrl(),
  fetchImpl = fetch,
  timeoutMs = 5_000
} = {}) {
  if (!baseUrl) return null
  const manifest = await fetchJson(`${baseUrl}/catalogue/manifest.json`, fetchImpl, {
    headers: { Accept: 'application/json' },
    cache: 'force-cache',
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!validManifest(manifest)) throw new Error('Static catalogue manifest is invalid.')
  return manifest
}

export async function fetchNearbyStaticPlaces({
  latitude,
  longitude,
  radiusKm = 25,
  limit = 96,
  baseUrl = staticCatalogueBaseUrl(),
  fetchImpl = fetch,
  timeoutMs = 6_000
} = {}) {
  if (!baseUrl || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return { manifest: null, places: [], tilesRequested: 0, tilesLoaded: 0 }
  }
  const manifest = await fetchStaticCatalogueManifest({ baseUrl, fetchImpl, timeoutMs })
  const tiles = tileCoordinatesForRadius(latitude, longitude, radiusKm, Number(manifest.zoom))
  const tileLimit = Math.max(1, Math.min(128, Number(process.env.STATIC_CATALOGUE_MAX_TILES || 64)))
  const selectedTiles = tiles.slice(0, tileLimit)
  let tilesLoaded = 0
  const payloads = await Promise.all(selectedTiles.map(async (tile) => {
    const url = `${baseUrl}/${tileObjectKey(manifest.release, tile)}`
    try {
      const payload = await fetchJson(url, fetchImpl, {
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
        next: { revalidate: 86_400 },
        signal: AbortSignal.timeout(timeoutMs)
      })
      tilesLoaded += 1
      return Array.isArray(payload?.p) ? payload.p : Array.isArray(payload) ? payload : []
    } catch (error) {
      if (error?.status === 404) return []
      throw error
    }
  }))

  const radiusMeters = Math.max(0.1, Number(radiusKm) || 25) * 1_000
  const seen = new Set()
  const places = payloads.flatMap((payload) => payload)
    .map(unpackStaticPlace)
    .filter(Boolean)
    .map((place) => ({
      ...place,
      distanceM: haversineDistanceMeters(latitude, longitude, place.latitude, place.longitude)
    }))
    .filter((place) => place.distanceM !== null && place.distanceM <= radiusMeters)
    .filter((place) => {
      const key = `${place.source}:${place.sourcePlaceId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.distanceM - b.distanceM || String(a.name).localeCompare(String(b.name)))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 96)))

  return { manifest, places, tilesRequested: selectedTiles.length, tilesLoaded }
}

export const staticCatalogueSchema = Object.freeze({
  version: STATIC_SCHEMA_VERSION,
  defaultZoom: DEFAULT_ZOOM,
  placeFields: PLACE_FIELDS,
  placeholderCategories: PLACEHOLDER_CATEGORIES
})
