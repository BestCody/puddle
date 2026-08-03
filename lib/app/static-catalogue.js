import { staticCatalogueLocationId } from './static-catalogue-id.js'

const DEFAULT_ZOOM = 10
const MAX_MERCATOR_LATITUDE = 85.05112878
const STATIC_SCHEMA_VERSION = 3
const MEDIA_SCHEMA_VERSION = 1
const WEEKDAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])

const DECK_FIELDS = Object.freeze([
  'source', 'sourcePlaceId', 'name', 'kind', 'latitudeE5', 'longitudeE5',
  'city', 'region', 'country', 'countryCode', 'priceLevel', 'timezone',
  'openingHoursCompact', 'amenityCodes', 'accessibilityBits'
])

const DETAIL_FIELDS = Object.freeze([
  'summary', 'duplicateGroupKey', 'catalogueGroupKey', 'neighborhood', 'regionCode',
  'postalCode', 'addressPublic', 'brandId', 'brandName', 'sourceParentPlaceId',
  'websiteUrl', 'phonePublic'
])

const PROVENANCE_FIELDS = Object.freeze([
  'sourceUpdatedAt', 'sourceConfidence', 'sourceOperatingStatus', 'payloadHash',
  'categoryConfidence', 'sourceMetadata'
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

function quantizeCoordinate(value) {
  const parsed = finite(value)
  return parsed === null ? null : Math.round(parsed * 100_000)
}

function restoreCoordinate(value) {
  const parsed = finite(value)
  return parsed === null ? null : parsed / 100_000
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

function explicitLoopbackHttp(url) {
  if (process.env.STATIC_CATALOGUE_ALLOW_INSECURE_LOCALHOST !== 'true' || url.protocol !== 'http:') return false
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
}

function compactOpeningHours(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const compact = WEEKDAYS.map((day) => String(source[day] || '').trim() || null)
  while (compact.length && compact.at(-1) === null) compact.pop()
  return compact
}

function restoreOpeningHours(value) {
  if (!Array.isArray(value)) return {}
  return Object.fromEntries(value.flatMap((hours, index) => hours && WEEKDAYS[index] ? [[WEEKDAYS[index], hours]] : []))
}

function compactAmenities(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean))]
    .slice(0, 12)
}

function accessibilityBits(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return (source.wheelchair_accessible ? 1 : 0) | (source.step_free ? 2 : 0)
}

function restoreAccessibility(value) {
  const bits = Math.max(0, Math.trunc(finite(value, 0)))
  return {
    wheelchair_accessible: Boolean(bits & 1),
    step_free: Boolean(bits & 2)
  }
}

export function staticCatalogueBaseUrl(value = process.env.STATIC_CATALOGUE_BASE_URL || process.env.NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL) {
  try {
    const url = new URL(String(value || ''))
    const developmentHttp = process.env.NODE_ENV !== 'production' && url.protocol === 'http:'
    if (url.protocol !== 'https:' && !developmentHttp && !explicitLoopbackHttp(url)) return null
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
  const center = lonLatToTile(longitude, latitude, zoom)
  coordinates.sort((a, b) => {
    const aDistance = (a.x - center.x) ** 2 + (a.y - center.y) ** 2
    const bDistance = (b.x - center.x) ** 2 + (b.y - center.y) ** 2
    return aDistance - bDistance || a.x - b.x || a.y - b.y
  })
  return coordinates
}

export function tileObjectKey(release, tile) {
  const version = String(release || '').trim()
  if (!version) throw new Error('Static catalogue release is missing.')
  return `catalogue/releases/${rfc3986Segment(version)}/tiles/${tile.z}/${tile.x}/${tile.y}.json`
}

export function detailObjectKey(release, tile) {
  const version = String(release || '').trim()
  if (!version) throw new Error('Static catalogue release is missing.')
  return `catalogue/releases/${rfc3986Segment(version)}/details/${tile.z}/${tile.x}/${tile.y}.json`
}

export function provenanceObjectKey(release, tile) {
  const version = String(release || '').trim()
  if (!version) throw new Error('Static catalogue release is missing.')
  return `catalogue/releases/${rfc3986Segment(version)}/provenance/${tile.z}/${tile.x}/${tile.y}.json`
}

export function mediaOverlayObjectKey(tile) {
  return `catalogue/media/v${MEDIA_SCHEMA_VERSION}/${tile.z}/${tile.x}/${tile.y}.json`
}

export function packStaticPlace(item, source = 'overture') {
  const value = {
    ...item,
    source: item?.source || source,
    latitudeE5: quantizeCoordinate(item?.latitude),
    longitudeE5: quantizeCoordinate(item?.longitude),
    openingHoursCompact: compactOpeningHours(item?.openingHours),
    amenityCodes: compactAmenities(item?.amenities),
    accessibilityBits: accessibilityBits(item?.accessibility)
  }
  return DECK_FIELDS.map((field) => value[field] ?? null)
}

export function packStaticDetail(item, source = 'overture') {
  const value = { ...item, source: item?.source || source }
  return [value.source, value.sourcePlaceId, ...DETAIL_FIELDS.map((field) => value[field] ?? null)]
}

export function packStaticProvenance(item, source = 'overture') {
  const value = { ...item, source: item?.source || source }
  return [value.source, value.sourcePlaceId, ...PROVENANCE_FIELDS.map((field) => value[field] ?? null)]
}

export function unpackStaticPlace(record) {
  if (!Array.isArray(record) || record.length < 6) return null
  const item = Object.fromEntries(DECK_FIELDS.map((field, index) => [field, record[index] ?? null]))
  item.latitude = restoreCoordinate(item.latitudeE5)
  item.longitude = restoreCoordinate(item.longitudeE5)
  item.openingHours = restoreOpeningHours(item.openingHoursCompact)
  item.amenities = compactAmenities(item.amenityCodes)
  item.accessibility = restoreAccessibility(item.accessibilityBits)
  delete item.latitudeE5
  delete item.longitudeE5
  delete item.openingHoursCompact
  delete item.amenityCodes
  delete item.accessibilityBits
  if (!item.source || !item.sourcePlaceId || !item.name || !item.kind || item.latitude === null || item.longitude === null) return null
  item.priceLevel = Number.isInteger(Number(item.priceLevel)) ? Number(item.priceLevel) : null
  return item
}

export function unpackStaticDetail(record) {
  if (!Array.isArray(record) || record.length < 2) return null
  const item = { source: record[0], sourcePlaceId: record[1] }
  for (let index = 0; index < DETAIL_FIELDS.length; index += 1) item[DETAIL_FIELDS[index]] = record[index + 2] ?? null
  return item
}

export function unpackStaticProvenance(record) {
  if (!Array.isArray(record) || record.length < 2) return null
  const item = { source: record[0], sourcePlaceId: record[1] }
  for (let index = 0; index < PROVENANCE_FIELDS.length; index += 1) item[PROVENANCE_FIELDS[index]] = record[index + 2] ?? null
  item.sourceConfidence = finite(item.sourceConfidence)
  item.categoryConfidence = finite(item.categoryConfidence)
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

async function fetchJson(url, fetchImpl, options, { allow404 = false } = {}) {
  const response = await fetchImpl(url, options)
  if (allow404 && response.status === 404) return null
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

function unpackMediaOverlay(payload) {
  const rows = Array.isArray(payload?.m) ? payload.m : []
  return new Map(rows.flatMap((row) => {
    if (!Array.isArray(row) || !row[0]) return []
    return [[String(row[0]), {
      photoUrl: row[1] || null,
      provider: row[2] || null,
      attribution: row[3] || null,
      attributionUrl: row[4] || null,
      license: row[5] || null,
      googlePlaceId: row[6] || null,
      googleMatchScore: finite(row[7])
    }]]
  }))
}

async function fetchDeckTile({ baseUrl, manifest, tile, fetchImpl, timeoutMs, includeDetails = false }) {
  const options = {
    headers: { Accept: 'application/json' },
    cache: 'force-cache',
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(timeoutMs)
  }
  const [deck, media, details] = await Promise.all([
    fetchJson(`${baseUrl}/${tileObjectKey(manifest.release, tile)}`, fetchImpl, options, { allow404: true }),
    fetchJson(`${baseUrl}/${mediaOverlayObjectKey(tile)}`, fetchImpl, {
      ...options,
      next: { revalidate: 300 }
    }, { allow404: true }),
    includeDetails
      ? fetchJson(`${baseUrl}/${detailObjectKey(manifest.release, tile)}`, fetchImpl, options, { allow404: true })
      : Promise.resolve(null)
  ])
  const detailMap = new Map((Array.isArray(details?.d) ? details.d : []).flatMap((row) => {
    const detail = unpackStaticDetail(row)
    return detail ? [[`${detail.source}:${detail.sourcePlaceId}`, detail]] : []
  }))
  const mediaMap = unpackMediaOverlay(media)
  const places = (Array.isArray(deck?.p) ? deck.p : Array.isArray(deck) ? deck : [])
    .map(unpackStaticPlace)
    .filter(Boolean)
    .map((place) => {
      const contentId = staticCatalogueLocationId(place.source, place.sourcePlaceId)
      return {
        ...place,
        ...(detailMap.get(`${place.source}:${place.sourcePlaceId}`) || {}),
        contentId,
        tile: { z: tile.z, x: tile.x, y: tile.y, key: tile.key || `${tile.z}/${tile.x}/${tile.y}` },
        media: mediaMap.get(contentId) || null
      }
    })
  return { tile, loaded: Boolean(deck), places }
}

function eligiblePlaces(payloads, latitude, longitude, radiusMeters) {
  const seen = new Set()
  return payloads.flatMap((payload) => payload.places)
    .map((place) => ({
      ...place,
      distanceM: haversineDistanceMeters(latitude, longitude, place.latitude, place.longitude)
    }))
    .filter((place) => place.distanceM !== null && place.distanceM <= radiusMeters)
    .filter((place) => {
      if (seen.has(place.contentId)) return false
      seen.add(place.contentId)
      return true
    })
    .sort((a, b) => a.distanceM - b.distanceM || String(a.name).localeCompare(String(b.name)))
}

export async function fetchNearbyStaticPlaces({
  latitude,
  longitude,
  radiusKm = 25,
  limit = 96,
  includeDetails = false,
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
  const concurrency = Math.max(1, Math.min(12, Number(process.env.STATIC_CATALOGUE_TILE_CONCURRENCY || 6)))
  const target = Math.max(1, Math.min(500, Number(limit) || 96))
  const radiusMeters = Math.max(0.1, Number(radiusKm) || 25) * 1_000
  const payloads = []
  let tilesRequested = 0

  for (let index = 0; index < Math.min(tileLimit, tiles.length); index += concurrency) {
    const batch = tiles.slice(index, Math.min(index + concurrency, tileLimit))
    const loaded = await Promise.all(batch.map((tile) => fetchDeckTile({
      baseUrl, manifest, tile, fetchImpl, timeoutMs, includeDetails
    })))
    payloads.push(...loaded)
    tilesRequested += batch.length
    if (eligiblePlaces(payloads, latitude, longitude, radiusMeters).length >= target) break
  }

  const places = eligiblePlaces(payloads, latitude, longitude, radiusMeters).slice(0, target)
  return {
    manifest,
    places,
    tilesRequested,
    tilesLoaded: payloads.filter((payload) => payload.loaded).length
  }
}

function referenceGroupKey(reference) {
  const tile = reference?.tile || {}
  return `${reference?.release || ''}:${tile.z}:${tile.x}:${tile.y}`
}

export async function fetchStaticPlacesByReferences(references, {
  baseUrl = staticCatalogueBaseUrl(),
  fetchImpl = fetch,
  timeoutMs = 6_000
} = {}) {
  const requested = (references || []).filter((reference) => reference?.id && reference?.release && reference?.tile)
  const result = new Map()
  if (!baseUrl || !requested.length) return result
  const grouped = new Map()
  for (const reference of requested) {
    const key = referenceGroupKey(reference)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(reference)
  }
  const options = {
    headers: { Accept: 'application/json' },
    cache: 'force-cache',
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(timeoutMs)
  }
  await Promise.all([...grouped.values()].map(async (group) => {
    const first = group[0]
    const [deck, details] = await Promise.all([
      fetchJson(`${baseUrl}/${tileObjectKey(first.release, first.tile)}`, fetchImpl, options, { allow404: true }),
      fetchJson(`${baseUrl}/${detailObjectKey(first.release, first.tile)}`, fetchImpl, options, { allow404: true })
    ])
    const deckMap = new Map((Array.isArray(deck?.p) ? deck.p : []).map(unpackStaticPlace).filter(Boolean)
      .map((place) => [`${place.source}:${place.sourcePlaceId}`, place]))
    const detailMap = new Map((Array.isArray(details?.d) ? details.d : []).map(unpackStaticDetail).filter(Boolean)
      .map((detail) => [`${detail.source}:${detail.sourcePlaceId}`, detail]))
    for (const reference of group) {
      const key = `${reference.source}:${reference.sourcePlaceId}`
      const deckPlace = deckMap.get(key)
      if (!deckPlace) continue
      const contentId = staticCatalogueLocationId(deckPlace.source, deckPlace.sourcePlaceId)
      if (contentId !== reference.id) continue
      result.set(reference.id, {
        ...deckPlace,
        ...(detailMap.get(key) || {}),
        contentId,
        tile: { ...reference.tile, key: `${reference.tile.z}/${reference.tile.x}/${reference.tile.y}` }
      })
    }
  }))
  return result
}

export async function fetchStaticPlaceByReference(reference, options = {}) {
  return (await fetchStaticPlacesByReferences([reference], options)).get(reference?.id) || null
}

export const staticCatalogueSchema = Object.freeze({
  version: STATIC_SCHEMA_VERSION,
  mediaVersion: MEDIA_SCHEMA_VERSION,
  defaultZoom: DEFAULT_ZOOM,
  placeFields: DECK_FIELDS,
  detailFields: DETAIL_FIELDS,
  provenanceFields: PROVENANCE_FIELDS,
  placeholderCategories: PLACEHOLDER_CATEGORIES,
  weekdays: WEEKDAYS
})
