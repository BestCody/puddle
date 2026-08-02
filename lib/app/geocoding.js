const DEFAULT_BASE_URL = 'https://api.geoapify.com/v1/geocode'
const REQUEST_TIMEOUT_MS = 8_000

function text(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function unique(values) {
  const seen = new Set()
  return values.filter((value) => {
    const normalized = text(value)
    if (!normalized || seen.has(normalized.toLowerCase())) return false
    seen.add(normalized.toLowerCase())
    return true
  })
}

export function geocodingConfigured() {
  return Boolean(process.env.GEOCODING_API_KEY)
}

function providerConfig() {
  const apiKey = text(process.env.GEOCODING_API_KEY, 500)
  const baseUrl = text(process.env.GEOCODING_PROVIDER_URL, 500) || DEFAULT_BASE_URL
  if (!apiKey) throw new Error('City search is not configured.')
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'https:') throw new Error('Geocoding provider must use HTTPS.')
  return { apiKey, baseUrl: parsed.toString().replace(/\/$/, '') }
}

function endpoint(baseUrl, path) {
  if (baseUrl.includes('{path}')) return baseUrl.replace('{path}', path)
  if (/\/(search|reverse)$/.test(baseUrl)) return baseUrl.replace(/\/(search|reverse)$/, `/${path}`)
  return `${baseUrl}/${path}`
}

export function normalizeGeocodingResult(row = {}) {
  const coordinates = row.geometry?.coordinates
  const latitude = number(row.lat ?? row.latitude ?? coordinates?.[1])
  const longitude = number(row.lon ?? row.lng ?? row.longitude ?? coordinates?.[0])
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  const properties = row.properties || row
  const city = text(properties.city || properties.name || properties.county || properties.state, 120)
  const region = text(properties.state || properties.region || properties.county, 120) || null
  const country = text(properties.country, 120) || null
  const countryCode = text(properties.country_code || properties.countryCode, 2).toUpperCase() || null
  const timezone = text(properties.timezone?.name || properties.timezone, 80) || 'UTC'
  if (!city) return null

  return {
    providerId: text(properties.place_id || row.id, 500) || null,
    city,
    region,
    country,
    countryCode,
    latitude,
    longitude,
    timezone,
    label: text(properties.formatted || properties.label || row.place_name, 240) || unique([city, region, country]).join(', '),
    confidence: number(properties.rank?.confidence),
    resultType: text(properties.result_type || properties.feature_type, 40) || 'city'
  }
}

async function providerRequest(path, params, { signal } = {}) {
  const { apiKey, baseUrl } = providerConfig()
  const url = new URL(endpoint(baseUrl, path))
  const geoapify = url.hostname === 'geoapify.com' || url.hostname.endsWith('.geoapify.com')
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    if (geoapify && ['q', 'latitude', 'longitude'].includes(key)) continue
    if (!geoapify && ['text', 'lat', 'lon'].includes(key)) continue
    url.searchParams.set(key, String(value))
  }
  url.searchParams.set('format', 'json')
  url.searchParams.set(geoapify ? 'apiKey' : 'key', apiKey)
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Puddle/1.0 worldwide location search' },
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Location provider returned ${response.status}.`)
  const payload = await response.json()
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.features)) return payload.features
  if (Array.isArray(payload?.data)) return payload.data
  return Array.isArray(payload) ? payload : []
}

export async function searchCities(query, { language = 'en', limit = 6, signal } = {}) {
  const normalizedQuery = text(query, 120)
  if (normalizedQuery.length < 2) return []
  const rows = await providerRequest('search', {
    text: normalizedQuery,
    q: normalizedQuery,
    type: 'city',
    lang: text(language, 2).toLowerCase() || 'en',
    limit: Math.max(1, Math.min(10, Number(limit) || 6))
  }, { signal })
  return rows.map(normalizeGeocodingResult).filter(Boolean)
}

export async function reverseGeocodeLocation(latitude, longitude, { language = 'en', signal } = {}) {
  const lat = number(latitude)
  const lon = number(longitude)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Location coordinates are invalid.')
  const rows = await providerRequest('reverse', {
    lat,
    lon,
    latitude: lat,
    longitude: lon,
    type: 'city',
    lang: text(language, 2).toLowerCase() || 'en',
    limit: 1
  }, { signal })
  const result = normalizeGeocodingResult(rows[0])
  if (!result) throw new Error('We could not identify that location.')
  return { ...result, latitude: lat, longitude: lon }
}

export async function geocodeAddress(address, { signal } = {}) {
  const query = text(address, 400)
  if (query.length < 4) throw new Error('Enter a more complete address or place name.')
  if (!geocodingConfigured()) return { configured: false, result: null }
  const rows = await providerRequest('search', { text: query, q: query, limit: 1 }, { signal })
  const result = normalizeGeocodingResult(rows[0])
  return { configured: true, result }
}
