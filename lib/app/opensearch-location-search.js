const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

function text(value, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function retryDelay(attempt, retryAfter) {
  const raw = text(retryAfter, 100)
  if (/^\d+$/.test(raw)) return Math.min(30_000, Number(raw) * 1000)
  return Math.min(10_000, 400 * (2 ** attempt) + Math.floor(Math.random() * 150))
}

function endpointFromEnv(env = process.env) {
  const raw = text(env.GLOBAL_LOCATION_SEARCH_URL || env.OPENSEARCH_URL, 2000)
  if (!raw) return null
  const url = new URL(raw)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Global location search URL must use HTTPS outside local development.')
  if (url.username || url.password) throw new Error('Do not embed OpenSearch credentials in GLOBAL_LOCATION_SEARCH_URL.')
  return url.toString().replace(/\/+$/, '')
}

export function openSearchLocationSearchConfig(env = process.env) {
  return {
    backend: 'opensearch',
    endpoint: endpointFromEnv(env),
    index: text(env.GLOBAL_LOCATION_SEARCH_INDEX || env.OPENSEARCH_LOCATION_INDEX || 'locations-active', 200),
    username: text(env.OPENSEARCH_USERNAME, 500),
    password: text(env.OPENSEARCH_PASSWORD, 2000),
    bearerToken: text(env.OPENSEARCH_BEARER_TOKEN, 4000),
    timeoutMs: integer(env.GLOBAL_LOCATION_SEARCH_TIMEOUT_MS, 5000, 1000, 15000),
    candidateLimit: integer(env.GLOBAL_LOCATION_CANDIDATE_LIMIT, 500, 100, 1000)
  }
}

export function isOpenSearchLocationSearchConfigured(env = process.env) {
  const config = openSearchLocationSearchConfig(env)
  return Boolean(config.endpoint && config.index)
}

function authHeaders(config) {
  if (config.bearerToken) return { Authorization: `Bearer ${config.bearerToken}` }
  if (config.username || config.password) {
    if (!config.username || !config.password) throw new Error('Both OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD are required for basic authentication.')
    return { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}` }
  }
  return {}
}

function traceHeaders(traceId) {
  const value = text(traceId, 64)
  return /^[0-9a-f]{32}$/i.test(value) ? { 'x-puddle-trace-id': value } : {}
}

function queryText(filters) {
  const q = text(filters?.q, 200)
  if (!q) return null
  return {
    multi_match: {
      query: q,
      type: 'best_fields',
      fields: ['name^5', 'aliases^3', 'category^2', 'city^2', 'neighborhood^2', 'address'],
      fuzziness: 'AUTO'
    }
  }
}

function finiteCoordinate(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`)
  return number
}

export function normalizeOpenSearchViewport({ north, south, east, west, zoom } = {}) {
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

export function openSearchViewportLocationLimit(zoom) {
  const level = Number(zoom)
  if (!Number.isFinite(level) || level < 6) return 80
  if (level < 9) return 100
  if (level < 12) return 120
  if (level < 15) return 150
  return 180
}

function viewportGeoFilter(bounds) {
  const box = (west, east) => ({
    geo_bounding_box: {
      location: {
        top_left: { lat: bounds.north, lon: west },
        bottom_right: { lat: bounds.south, lon: east }
      }
    }
  })
  if (bounds.west <= bounds.east) return box(bounds.west, bounds.east)
  return { bool: { should: [box(bounds.west, 180), box(-180, bounds.east)], minimum_should_match: 1 } }
}

export function buildOpenSearchViewportSearchBody({ north, south, east, west, zoom, candidateLimit } = {}) {
  const bounds = normalizeOpenSearchViewport({ north, south, east, west, zoom })
  const limit = integer(candidateLimit, openSearchViewportLocationLimit(bounds.zoom), 1, 250)
  const bool = {
    filter: [viewportGeoFilter(bounds), { term: { status: 'published' } }],
    should: [{ exists: { field: 'primary_photo.content_hash' } }],
    minimum_should_match: 0
  }
  return {
    size: limit,
    track_total_hits: false,
    _source: ['id', 'slug', 'name', 'summary', 'description', 'category', 'country', 'country_code', 'region', 'city', 'neighborhood', 'latitude', 'longitude', 'quality_score', 'popularity_score', 'primary_photo', 'status'],
    query: {
      function_score: {
        query: { bool },
        boost_mode: 'sum',
        score_mode: 'sum',
        functions: [
          { field_value_factor: { field: 'quality_score', factor: 2, missing: 0 } },
          { field_value_factor: { field: 'popularity_score', factor: 0.25, missing: 0 } }
        ]
      }
    },
    sort: [{ _score: 'desc' }, { popularity_score: 'desc' }, { quality_score: 'desc' }, { id: 'asc' }]
  }
}

export function buildOpenSearchLocationSearchBody({ latitude, longitude, distanceKm, filters = {}, excludeIds = [], preferredCategories = [], candidateLimit = 500 } = {}) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  const distance = Number(distanceKm)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Global location search requires finite coordinates.')
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('Global location search requires a positive distance.')

  const bool = { filter: [], must: [], must_not: [], should: [] }
  bool.filter.push({ geo_distance: { distance: `${Math.min(100, distance)}km`, location: { lat, lon } } })
  bool.filter.push({ term: { status: 'published' } })
  const category = text(filters.category, 80)
  if (category) bool.filter.push({ term: { category } })
  if (/^[1-4]$/.test(String(filters.price || ''))) bool.filter.push({ term: { price_level: Number(filters.price) } })
  const amenity = text(filters.amenity, 100).toLowerCase()
  if (amenity) bool.filter.push({ term: { amenities: amenity } })
  if (filters.accessible) bool.filter.push({ term: { accessible: true } })
  const fullText = queryText(filters)
  if (fullText) bool.must.push(fullText)
  const excludes = [...new Set((excludeIds || []).map(String).filter(Boolean))].slice(0, 10_000)
  if (excludes.length) bool.must_not.push({ terms: { id: excludes } })
  for (const categoryName of [...new Set((preferredCategories || []).map((value) => text(value, 80)).filter(Boolean))].slice(0, 20)) {
    bool.should.push({ term: { category: { value: categoryName, boost: 1.8 } } })
  }
  bool.should.push({ exists: { field: 'primary_photo.content_hash' } })
  bool.minimum_should_match = 0

  return {
    size: integer(candidateLimit, 500, 1, 1000),
    track_total_hits: false,
    _source: [
      'id', 'slug', 'name', 'summary', 'description', 'category', 'subcategory', 'country', 'country_code',
      'region', 'region_code', 'city', 'neighborhood', 'postal_code', 'address', 'latitude', 'longitude',
      'timezone', 'timezone_verified', 'opening_hours', 'price_level', 'amenities', 'accessibility', 'accessible',
      'website_url', 'phone_public', 'brand_id', 'brand_name', 'source_parent_place_id', 'duplicate_group_key',
      'catalogue_group_key', 'quality_score', 'popularity_score', 'primary_photo', 'google_place_id',
      'google_place_match_score', 'updated_at', 'status'
    ],
    query: {
      function_score: {
        query: { bool }, boost_mode: 'sum', score_mode: 'sum',
        functions: [
          { field_value_factor: { field: 'quality_score', factor: 2, missing: 0 } },
          { field_value_factor: { field: 'popularity_score', factor: 0.25, missing: 0 } }
        ]
      }
    },
    sort: [
      { _score: 'desc' },
      { _geo_distance: { location: { lat, lon }, order: 'asc', unit: 'm', mode: 'min', distance_type: 'arc' } },
      { id: 'asc' }
    ]
  }
}

function normalizeHit(hit) {
  const source = hit?._source || {}
  const distance = Array.isArray(hit?.sort) ? hit.sort.find((value, index) => index > 0 && Number.isFinite(Number(value))) : null
  return {
    ...source,
    id: source.id || hit?._id || null,
    distance_m: Number.isFinite(Number(distance)) ? Number(distance) : null,
    search_score: Number.isFinite(Number(hit?._score)) ? Number(hit._score) : 0
  }
}

async function executeSearch(body, { fetchFn = fetch, env = process.env, includeDistance = true, traceId = null } = {}) {
  const config = openSearchLocationSearchConfig(env)
  if (!config.endpoint) throw new Error('GLOBAL_LOCATION_SEARCH_URL is not configured.')
  const url = `${config.endpoint}/${encodeURIComponent(config.index)}/_search`
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...traceHeaders(traceId), ...authHeaders(config) },
        body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs)
      })
    } catch (error) {
      lastError = error
      if (attempt === 2) throw error
      await sleep(retryDelay(attempt))
      continue
    }
    if (response.ok) {
      const payload = await response.json()
      const candidates = (payload?.hits?.hits || []).map(normalizeHit).map((candidate) => includeDistance ? candidate : { ...candidate, distance_m: null })
      return { tookMs: Number(payload?.took || 0), timedOut: Boolean(payload?.timed_out), candidates, candidateLimit: body.size, index: config.index, backend: 'opensearch' }
    }
    const message = await response.text().catch(() => '')
    const error = new Error(`Global location search returned ${response.status}${message ? `: ${message.slice(0, 300)}` : ''}.`)
    error.status = response.status
    lastError = error
    if (!RETRYABLE.has(response.status) || attempt === 2) throw error
    await sleep(retryDelay(attempt, response.headers.get('retry-after')))
  }
  throw lastError || new Error('Global location search failed.')
}

export async function searchOpenSearchLocations(input, options = {}) {
  const config = openSearchLocationSearchConfig(options.env || process.env)
  return executeSearch(buildOpenSearchLocationSearchBody({ ...input, candidateLimit: input?.candidateLimit || config.candidateLimit }), options)
}

export async function searchOpenSearchLocationsInViewport(input, options = {}) {
  return executeSearch(buildOpenSearchViewportSearchBody(input), { ...options, includeDistance: false })
}

export async function getOpenSearchLocationBySlug(slug, { fetchFn = fetch, env = process.env, traceId = null } = {}) {
  const config = openSearchLocationSearchConfig(env)
  if (!config.endpoint) return null
  const safeSlug = text(slug, 240)
  if (!safeSlug) return null
  const response = await fetchFn(`${config.endpoint}/${encodeURIComponent(config.index)}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...traceHeaders(traceId), ...authHeaders(config) },
    body: JSON.stringify({ size: 1, query: { term: { slug: safeSlug } } }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs)
  })
  if (!response.ok) throw new Error(`Global location lookup returned ${response.status}.`)
  const payload = await response.json()
  const row = normalizeHit(payload?.hits?.hits?.[0] || null)
  return row?.id ? row : null
}

export async function getOpenSearchLocationsByIds(ids = [], { fetchFn = fetch, env = process.env, traceId = null } = {}) {
  const config = openSearchLocationSearchConfig(env)
  if (!config.endpoint) return []
  const values = [...new Set((ids || []).map((value) => text(value, 100)).filter(Boolean))].slice(0, 1000)
  if (!values.length) return []
  const response = await fetchFn(`${config.endpoint}/${encodeURIComponent(config.index)}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...traceHeaders(traceId), ...authHeaders(config) },
    body: JSON.stringify({ size: values.length, query: { terms: { id: values } } }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs)
  })
  if (!response.ok) throw new Error(`Global location ID lookup returned ${response.status}.`)
  const payload = await response.json()
  return (payload?.hits?.hits || []).map(normalizeHit).filter((row) => row.id)
}
