import test from 'node:test'
import assert from 'node:assert/strict'
import { brotliCompressSync, zstdCompressSync } from 'node:zlib'
import {
  getB2GlobalLocationBySlug,
  getB2GlobalLocationsByIds,
  searchB2GlobalLocations,
  searchB2GlobalLocationsInViewport
} from '../../lib/app/b2-location-search.js'
import {
  clearLocationSearchCaches,
  directoryTilesForBounds,
  haversineDistanceMeters
} from '../../lib/app/location-search-shards.js'
import { clearB2SearchAuthorizationCache } from '../../lib/app/b2-search-object-store.js'
import { clearTextProjectionCaches, textProjectionObjectKey } from '../../lib/app/b2-text-search-projection.js'
import { normalizeSearchText, prepareTextQuery, scoreTextMatch } from '../../lib/app/location-search-ranking.js'

const env = {
  B2_DATA_APPLICATION_KEY_ID: 'key-id',
  B2_DATA_APPLICATION_KEY: 'application-key',
  B2_DATA_BUCKET_NAME: 'puddle-assets',
  GLOBAL_LOCATION_SEARCH_MANIFEST_KEY: 'data/search/active.json',
  GLOBAL_LOCATION_MAX_RADIUS_KM: '100',
  GLOBAL_LOCATION_MAX_DIRECTORY_TILES: '64',
  GLOBAL_LOCATION_MAX_SHARDS: '32',
  GLOBAL_LOCATION_MAX_COMPRESSED_BYTES: String(4 * 1024 * 1024),
  GLOBAL_LOCATION_MAX_CANDIDATES: '10000',
  GLOBAL_LOCATION_SEARCH_TIMEOUT_MS: '5000',
  GLOBAL_LOCATION_TEXT_PROJECTION: '1'
}

const tower = {
  id: 'loc-1', slug: 'cn-tower', name: 'CN Tower', aliases: [], category: 'landmark',
  latitude: 43.6426, longitude: -79.3871, city: 'Toronto', neighborhood: 'Downtown', address: '290 Bremner Blvd',
  quality_score: 0.95, popularity_score: 4, status: 'published', amenities: ['observation_deck'], accessible: true,
  primary_photo: { content_hash: 'abc' }
}
const cafe = {
  id: 'loc-2', slug: 'nearby-cafe', name: 'Nearby Cafe', aliases: [], category: 'cafe',
  latitude: 43.65, longitude: -79.39, city: 'Toronto', neighborhood: 'Downtown', address: '1 Front St',
  quality_score: 0.8, popularity_score: 2, status: 'published', amenities: [], accessible: false
}

function br(value) {
  return brotliCompressSync(Buffer.from(JSON.stringify(value)))
}

function projectionRow(document) {
  const aliases = Array.isArray(document.aliases) ? document.aliases : []
  const photo = document.primary_photo?.content_hash
    ? [document.primary_photo.content_hash, document.primary_photo.provider, document.primary_photo.attribution, document.primary_photo.attribution_url, document.primary_photo.license, document.primary_photo.width, document.primary_photo.height]
    : null
  return [
    document.id, document.slug, document.name, aliases, document.summary, document.description,
    document.category, document.subcategory, document.latitude, document.longitude, document.country,
    document.country_code, document.region, document.region_code, document.city, document.neighborhood,
    document.postal_code, document.address, document.timezone, Boolean(document.timezone_verified),
    document.opening_hours || {}, document.price_level, document.amenities || [], document.accessibility || {},
    Boolean(document.accessible), document.website_url, document.phone_public, document.brand_id, document.brand_name,
    document.source_parent_place_id, document.duplicate_group_key, document.catalogue_group_key,
    Number(document.quality_score || 0), Number(document.popularity_score || 0), document.google_place_id,
    document.google_place_match_score, document.status, document.updated_at, photo,
    normalizeSearchText(document.name), aliases.map(normalizeSearchText), normalizeSearchText(document.category),
    normalizeSearchText(document.city), normalizeSearchText(document.neighborhood), normalizeSearchText(document.address)
  ]
}

function fixtureFetch({ textProjection = false, requests = [] } = {}) {
  const prefix = 'data/search/schema=v1/snapshot=2026-08-19'
  const manifestKey = `${prefix}/manifest.json`
  const geoKey = `${prefix}/geo/r5/852b9b7bfffffff.json.br`
  const outsideRadiusKey = `${prefix}/geo/r8/outside-radius-corner.json.br`
  const denseViewportKey = `${prefix}/geo/r8/dense-viewport-edge.json.br`
  const geoBody = br([tower, cafe])
  const manifest = {
    schema_version: 1, snapshot: '2026-08-19', source_snapshot: '2026-08-19', prefix,
    planner: { id: 'fixture-planner' },
    geo: { directory: { tile_degrees: 1, prefix: `${prefix}/routing` } },
    geo_map: {
      z0: { tile_degrees: 30, prefix: `${prefix}/geo-map/z0` },
      z1: { tile_degrees: 10, prefix: `${prefix}/geo-map/z1` }
    }
  }
  const objects = new Map([
    ['data/search/active.json', Buffer.from(JSON.stringify({ schema_version: 1, snapshot: '2026-08-19', manifest_key: manifestKey }))],
    [manifestKey, Buffer.from(JSON.stringify(manifest))],
    [`${prefix}/routing/133/100.json.br`, br([
      [geoKey, '852b9b7bfffffff', 44, 43, -79, -80, 2, geoBody.length],
      // This shard overlaps the radius bounding square but its entire bounding box is outside
      // the 25 km circle. If the planner includes it, the synthetic byte budget is exceeded.
      [outsideRadiusKey, '882b9b000000001', 43.87, 43.84, -79.12, -79.18, 5000, 4 * 1024 * 1024],
      // A dense viewport-only shard that causes a normal-zoom viewport to exceed the fine-plan
      // byte budget, forcing the bounded coarse-map fallback.
      [denseViewportKey, '882b9b000000002', 43.79, 43.75, -79.55, -79.59, 9000, 4 * 1024 * 1024]
    ])],
    [geoKey, geoBody],
    [`${prefix}/geo-map/z1/13/10.json.br`, br([tower, cafe])],
    [`${prefix}/id/60c.json.br`, br({ 'loc-1': tower })],
    [`${prefix}/slug/e79.json.br`, br({ 'cn-tower': 'loc-1' })]
  ])

  if (textProjection) {
    const readyKey = `${prefix}/text-projection-v1/fixture-planner/ready.json`
    objects.set(readyKey, Buffer.from(JSON.stringify({
      schema_version: 1,
      projection_version: 1,
      source_manifest_key: manifestKey,
      planner_id: 'fixture-planner'
    })))
    objects.set(
      textProjectionObjectKey(manifest, geoKey),
      zstdCompressSync(Buffer.from(JSON.stringify([1, [projectionRow(tower), projectionRow(cafe)]])))
    )
  }

  return async (url) => {
    const value = String(url)
    if (value === 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account') {
      return Response.json({
        accountId: 'account', authorizationToken: 'token',
        apiInfo: { storageApi: {
          apiUrl: 'https://api.example', downloadUrl: 'https://download.example',
          allowed: { buckets: [{ id: 'bucket-id', name: 'puddle-assets' }], capabilities: ['readFiles'], namePrefix: null },
          recommendedPartSize: 100000000
        } }
      })
    }
    const marker = '/file/puddle-assets/'
    const index = value.indexOf(marker)
    if (index < 0) return new Response('', { status: 404 })
    const key = value.slice(index + marker.length).split('/').map(decodeURIComponent).join('/')
    requests.push(key)
    const body = objects.get(key)
    return body ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) : new Response('', { status: 404 })
  }
}

function reset() {
  clearLocationSearchCaches()
  clearB2SearchAuthorizationCache()
  clearTextProjectionCaches()
}

test('bounded fuzzy scoring accepts a two-edit place-name typo', () => {
  const score = scoreTextMatch(tower, prepareTextQuery('cn towr'))
  assert.ok(score > 0)
})

test('directory routing handles date-line viewports without scanning the world', () => {
  const tiles = directoryTilesForBounds({ north: 0.9, south: -0.9, west: 179.1, east: -179.1 }, 1)
  assert.equal(tiles.length, 4)
})

test('haversine distance is exact enough for final radius filtering', () => {
  const meters = haversineDistanceMeters(43.6426, -79.3871, 43.65, -79.39)
  assert.ok(meters > 800 && meters < 900)
})

test('B2 radius search routes, filters, fuzzily matches, and ranks candidates', async () => {
  reset()
  const result = await searchB2GlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { q: 'cn towr', category: 'landmark' }, candidateLimit: 20
  }, { env, fetchFn: fixtureFetch() })
  assert.equal(result.backend, 'b2')
  assert.equal(result.index, 'b2:2026-08-19')
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.diagnostics.shards, 1)
  assert.equal(result.diagnostics.textProjection, false)
})

test('B2 text radius search uses compact projection without fetching the full geo object', async () => {
  reset()
  const requests = []
  const result = await searchB2GlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { q: 'cn towr', category: 'landmark' }, candidateLimit: 20
  }, { env, fetchFn: fixtureFetch({ textProjection: true, requests }) })
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.diagnostics.textProjection, true)
  assert.equal(result.diagnostics.textProjectionFallback, false)
  assert.equal(requests.some((key) => key.endsWith('/geo/r5/852b9b7bfffffff.json.br')), false)
  assert.equal(result.candidates[0].primary_photo.content_hash, tower.primary_photo.content_hash)
})

test('B2 viewport uses exact bounds at normal zoom', async () => {
  reset()
  const result = await searchB2GlobalLocationsInViewport({
    north: 43.74, south: 43.5, west: -79.6, east: -79.2, zoom: 11
  }, { env, fetchFn: fixtureFetch() })
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['loc-1', 'loc-2']))
  assert.equal(result.diagnostics.coarseFallback, undefined)
})

test('dense normal-zoom B2 viewport falls back to bounded coarse map instead of failing budget', async () => {
  reset()
  const result = await searchB2GlobalLocationsInViewport({
    north: 43.8, south: 43.5, west: -79.6, east: -79.2, zoom: 11
  }, { env, fetchFn: fixtureFetch() })
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['loc-1', 'loc-2']))
  assert.equal(result.diagnostics.coarse, true)
  assert.equal(result.diagnostics.coarseFallback, true)
  assert.equal(result.diagnostics.decodedCandidates, 2)
})

test('B2 ID and slug hydration use deterministic hash buckets', async () => {
  reset()
  const fetchFn = fixtureFetch()
  const ids = await getB2GlobalLocationsByIds(['loc-1'], { env, fetchFn })
  assert.equal(ids[0]?.id, 'loc-1')
  const bySlug = await getB2GlobalLocationBySlug('cn-tower', { env, fetchFn })
  assert.equal(bySlug?.id, 'loc-1')
})

test('radius guard rejects world-scale legacy scans before any B2 read', async () => {
  reset()
  await assert.rejects(
    () => searchB2GlobalLocations({ latitude: 43.65, longitude: -79.39, distanceKm: 20040 }, { env, fetchFn: fixtureFetch() }),
    /capped at 100 km/
  )
})
