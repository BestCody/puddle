import http from 'node:http'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'

const port = Number(process.env.E2E_GLOBAL_SEARCH_PORT || 39200)

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return
  visitor(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visitor)
}

function firstClause(body, key, field) {
  let found = null
  walk(body?.query, (node) => {
    if (found !== null) return
    const value = node?.[key]?.[field]
    if (value !== undefined) found = value
  })
  return found
}

function allClauseValues(body, key, field) {
  const values = []
  walk(body?.query, (node) => {
    const value = node?.[key]?.[field]
    if (value !== undefined) values.push(value)
  })
  return values
}

function haversineMeters(aLat, aLon, bLat, bLon) {
  const radius = 6371000
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(x))
}

function search(body) {
  let places = [...GLOBAL_LOCATION_FIXTURES]
  const slug = firstClause(body, 'term', 'slug')
  const directIds = Array.isArray(body?.query?.terms?.id) ? body.query.terms.id : null
  if (slug) places = places.filter((place) => place.slug === String(slug))
  if (directIds) {
    const allowed = new Set(directIds.map(String))
    places = places.filter((place) => allowed.has(place.id))
  }

  const categories = allClauseValues(body, 'term', 'category')
    .map((value) => typeof value === 'object' ? value?.value : value)
    .filter(Boolean)
  if (categories.length) {
    const allowed = new Set(categories.map(String))
    places = places.filter((place) => allowed.has(place.category))
  }

  const excludedGroups = allClauseValues(body, 'terms', 'id').filter(Array.isArray)
  if (!directIds && excludedGroups.length) {
    const excluded = new Set(excludedGroups.flat().map(String))
    places = places.filter((place) => !excluded.has(place.id))
  }

  let geoCenter = null
  walk(body?.query, (node) => {
    const geo = node?.geo_distance?.location
    if (geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lon))) {
      geoCenter = { lat: Number(geo.lat), lon: Number(geo.lon) }
    }
    const box = node?.geo_bounding_box?.location
    if (box?.top_left && box?.bottom_right) {
      const north = Number(box.top_left.lat)
      const west = Number(box.top_left.lon)
      const south = Number(box.bottom_right.lat)
      const east = Number(box.bottom_right.lon)
      places = places.filter((place) => place.latitude <= north && place.latitude >= south && place.longitude >= west && place.longitude <= east)
    }
  })

  const size = Math.max(0, Number(body?.size || places.length))
  return places.slice(0, size).map((place) => {
    const distance = geoCenter ? Math.round(haversineMeters(geoCenter.lat, geoCenter.lon, place.latitude, place.longitude)) : null
    return {
      _index: 'e2e-locations-active',
      _id: place.id,
      _score: 1,
      _source: place,
      sort: distance === null ? [1, place.id] : [1, distance, place.id]
    }
  })
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ ok: true }))
  }

  if (request.method !== 'POST' || !request.url?.endsWith('/_search')) {
    response.writeHead(404, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ error: 'not_found' }))
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  let body = {}
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' })
    return response.end(JSON.stringify({ error: 'invalid_json' }))
  }

  const hits = search(body)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    took: 1,
    timed_out: false,
    hits: {
      total: { value: hits.length, relation: 'eq' },
      max_score: hits.length ? 1 : null,
      hits
    }
  }))
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`E2E OpenSearch stub listening on http://127.0.0.1:${port}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
