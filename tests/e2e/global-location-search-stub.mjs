import http from 'node:http'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'

const port = Number(process.env.E2E_GLOBAL_SEARCH_PORT || 39200)

function haversineMeters(aLat, aLon, bLat, bLon) {
  const radius = 6371000
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(x))
}

function boolQuery(body) {
  return body?.query?.function_score?.query?.bool || body?.query?.bool || null
}

function termValue(clause, field) {
  const value = clause?.term?.[field]
  return typeof value === 'object' && value !== null ? value.value : value
}

function search(body) {
  let places = [...GLOBAL_LOCATION_FIXTURES]

  // Direct identity lookups are used by slug/detail hydration and lazy location_refs.
  const directSlug = termValue(body?.query, 'slug')
  const directIds = Array.isArray(body?.query?.terms?.id) ? body.query.terms.id.map(String) : null
  if (directSlug) places = places.filter((place) => place.slug === String(directSlug))
  if (directIds) {
    const allowed = new Set(directIds)
    places = places.filter((place) => allowed.has(place.id))
  }

  const bool = boolQuery(body)
  const filters = Array.isArray(bool?.filter) ? bool.filter : []
  const exclusions = Array.isArray(bool?.must_not) ? bool.must_not : []

  // Only category terms in bool.filter are hard filters. Category terms in
  // bool.should are preference boosts in production OpenSearch and must not
  // remove otherwise valid candidates from the E2E fixture catalogue.
  const category = filters.map((clause) => termValue(clause, 'category')).find(Boolean)
  if (category) places = places.filter((place) => place.category === String(category))

  const excludedIds = exclusions
    .flatMap((clause) => Array.isArray(clause?.terms?.id) ? clause.terms.id : [])
    .map(String)
  if (excludedIds.length) {
    const excluded = new Set(excludedIds)
    places = places.filter((place) => !excluded.has(place.id))
  }

  let geoCenter = null
  for (const clause of filters) {
    const geo = clause?.geo_distance?.location
    if (geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lon))) {
      geoCenter = { lat: Number(geo.lat), lon: Number(geo.lon) }
      const distanceKm = Number.parseFloat(String(clause.geo_distance.distance || '').replace(/km$/i, ''))
      if (Number.isFinite(distanceKm)) {
        places = places.filter((place) => haversineMeters(geoCenter.lat, geoCenter.lon, place.latitude, place.longitude) <= distanceKm * 1000)
      }
    }

    const box = clause?.geo_bounding_box?.location
    if (box?.top_left && box?.bottom_right) {
      const north = Number(box.top_left.lat)
      const west = Number(box.top_left.lon)
      const south = Number(box.bottom_right.lat)
      const east = Number(box.bottom_right.lon)
      places = places.filter((place) => {
        const latitudeMatch = place.latitude <= north && place.latitude >= south
        const longitudeMatch = west <= east
          ? place.longitude >= west && place.longitude <= east
          : place.longitude >= west || place.longitude <= east
        return latitudeMatch && longitudeMatch
      })
    }
  }

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
