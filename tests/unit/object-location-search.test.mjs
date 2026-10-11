import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { brotliCompressSync, zstdCompressSync } from 'node:zlib'
import {
  getObjectGlobalLocationBySlug,
  getObjectGlobalLocationsByIds,
  searchObjectGlobalLocations,
  searchObjectGlobalLocationsInViewport
} from '../../lib/app/object-location-search.js'
import {
  clearLocationSearchCaches,
  directoryTilesForBounds,
  haversineDistanceMeters
} from '../../lib/app/location-search-shards.js'
import { clearSearchObjectInFlightForTests } from '../../lib/app/search-object-store.js'
import { resetSelfHostObjectClientForTests, setSelfHostObjectClientForTests } from '../../lib/storage/self-host-object-store.js'
import { clearPhotoSearchOverlayCaches, getPhotoSearchOverlay } from '../../lib/app/photo-search-overlay.js'
import { clearTextProjectionCaches } from '../../lib/app/text-search-projection.js'
import { queryPrefixCodes } from '../../lib/app/text-postings.js'
import { normalizeSearchText, prepareTextQuery, scoreTextMatch } from '../../lib/app/location-search-ranking.js'

const env = {
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'puddle-assets',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'test-id',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret',
  GLOBAL_LOCATION_SEARCH_MANIFEST_KEY: 'data/search/active.json',
  GLOBAL_LOCATION_MAX_RADIUS_KM: '100',
  GLOBAL_LOCATION_MAX_DIRECTORY_TILES: '64',
  GLOBAL_LOCATION_MAX_SHARDS: '32',
  GLOBAL_LOCATION_MAX_COMPRESSED_BYTES: String(4 * 1024 * 1024),
  GLOBAL_LOCATION_MAX_CANDIDATES: '10000',
  GLOBAL_LOCATION_SEARCH_TIMEOUT_MS: '5000'
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

function zstd(value) {
  return zstdCompressSync(Buffer.from(JSON.stringify(value)))
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function core(row) {
  return [
    row.id, row.name, row.aliases || [], row.category || null, row.latitude, row.longitude,
    row.city || null, row.neighborhood || null, row.address || null, row.price_level ?? null,
    row.amenities || [], Boolean(row.accessible), Number(row.quality_score || 0), Number(row.popularity_score || 0),
    row.primary_photo?.content_hash || null, row.status || null,
    normalizeSearchText(row.name), (row.aliases || []).map(normalizeSearchText), normalizeSearchText(row.category),
    normalizeSearchText(row.city), normalizeSearchText(row.neighborhood), normalizeSearchText(row.address)
  ]
}

function detail(row) {
  const photo = row.primary_photo?.content_hash
    ? [row.primary_photo.content_hash, row.primary_photo.provider || null, row.primary_photo.attribution || null, row.primary_photo.attribution_url || null, row.primary_photo.license || null, row.primary_photo.width || null, row.primary_photo.height || null]
    : null
  return [
    row.id, row.slug || null, row.name || null, row.aliases || [], row.summary || null, row.description || null,
    row.category || null, row.subcategory || null, row.latitude, row.longitude, row.country || null, row.country_code || null,
    row.region || null, row.region_code || null, row.city || null, row.neighborhood || null, row.postal_code || null,
    row.address || null, row.timezone || null, Boolean(row.timezone_verified), row.opening_hours || {}, row.price_level ?? null,
    row.amenities || [], row.accessibility || {}, Boolean(row.accessible), row.website_url || null, row.phone_public || null,
    row.brand_id || null, row.brand_name || null, row.source_parent_place_id || null, row.duplicate_group_key || null,
    row.catalogue_group_key || null, Number(row.quality_score || 0), Number(row.popularity_score || 0), row.google_place_id || null,
    row.google_place_match_score ?? null, row.status || null, row.updated_at || null, photo
  ]
}

function fixtureObjectStore({ delayMs = 0, photoOverlay = false, photoBucketCount = 16, photoEntries = [], missingKey = null } = {}) {
  const prefix = 'data/search/schema=v1/snapshot=2026-08-19'
  const plannerId = 'fixture-pack-v1'
  const manifestKey = `${prefix}/manifest.json`
  const geoKey = `${prefix}/geo/r5/852b9b7bfffffff.json.br`
  const outsideRadiusKey = `${prefix}/geo/r8/outside-radius-corner.json.br`
  const denseViewportKey = `${prefix}/geo/r8/dense-viewport-edge.json.br`
  const geoBody = br([tower, cafe])
  const projectionBase = `${prefix}/text-projection-v1/${plannerId}`
  const projectionCandidateKey = `${projectionBase}/candidate.json`
  const coreKey = `${projectionBase}/core/${digest(geoKey)}.json.zst`
  const detailKey = `${projectionBase}/detail/${digest(geoKey)}/00000.json.zst`
  const overlayHash = 'a'.repeat(64)
  const manifest = {
    schema_version: 1, snapshot: '2026-08-19', source_snapshot: '2026-08-19', prefix,
    planner: { id: plannerId },
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
    [`${prefix}/id/60c.json.br`, br({ 'loc-1': tower, 'loc-2': cafe })],
    [`${prefix}/slug/e79.json.br`, br({ 'cn-tower': 'loc-1' })],
    [projectionCandidateKey, Buffer.from(JSON.stringify({
      schema_version: 1,
      projection_version: 1,
      source_manifest_key: manifestKey,
      planner_id: plannerId,
      detail_chunk_size: 64,
      object_count: 1,
      location_rows: 2
    }))],
    [coreKey, zstd([1, [core(tower), core(cafe)]])],
    [detailKey, zstd([1, 0, [detail(tower), detail(cafe)]])]
  ])
  if (photoOverlay) {
    const entries = photoEntries.length ? photoEntries : [['loc-2', [overlayHash, 'wikimedia-commons', 'Fixture', 'https://fixture.invalid', 'CC BY', 1200, 800]]]
    const grouped = new Map()
    for (const entry of entries) {
      const hash = createHash('sha256').update(entry[0]).digest()
      const window = photoBucketCount <= 256 ? hash[0] : hash.readUInt16BE(0)
      const bucket = (window & (photoBucketCount - 1)).toString(16).padStart(Math.max(2, Math.ceil(Math.log2(photoBucketCount) / 4)), '0')
      if (!grouped.has(bucket)) grouped.set(bucket, [])
      grouped.get(bucket).push(entry)
    }
    const shards = {}
    for (const [bucket, rows] of grouped) {
      const shardBody = br([2, rows])
      const shardDigest = createHash('sha256').update(shardBody).digest('hex')
      const shardKey = `data/search/photo-overlay-v2/objects/sha256=${shardDigest}/bucket=${bucket}.json.br`
      objects.set(shardKey, shardBody)
      shards[bucket] = { object_key: shardKey, object_sha256: shardDigest, photo_count: rows.length }
    }
    objects.set('data/search/photo-overlay-v1/active.json', Buffer.from(JSON.stringify({
      schema_version: 1,
      overlay_version: 2,
      source_snapshot: '2026-08-19',
      source_manifest_key: manifestKey,
      bucket_count: photoBucketCount,
      shards,
      photo_count: entries.length
    })))
  }
  const counts = new Map()

  setSelfHostObjectClientForTests({ send: async (command) => {
    const key = command.input.Key
    assert.equal(command.input.Bucket, env.OBJECT_STORAGE_BUCKET)
    counts.set(key, (counts.get(key) || 0) + 1)
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const body = key === missingKey ? null : objects.get(key)
    if (!body) throw Object.assign(new Error('Missing object'), { name: 'NoSuchKey' })
    return { ContentLength: body.length, Body: (async function* () { yield body })() }
  } })
  return { projectionCandidateKey, coreKey, detailKey, geoKey, manifest, manifestKey, counts }
}

function reset() {
  clearLocationSearchCaches()
  clearSearchObjectInFlightForTests()
  resetSelfHostObjectClientForTests()
  clearPhotoSearchOverlayCaches()
  clearTextProjectionCaches()
}

test('bounded fuzzy scoring accepts a two-edit place-name typo', () => {
  const score = scoreTextMatch(tower, prepareTextQuery('cn towr'))
  assert.ok(score > 0)
})

test('postings prefix codes index exactly three characters per token', () => {
  const codes = queryPrefixCodes(prepareTextQuery('JOE & THE JUICE'))
  // joe=12172, the=24880, jui=12392 under the builder's 36-char alphabet.
  assert.deepEqual(codes, [12172, 24880, 12392])
  assert.equal(queryPrefixCodes(prepareTextQuery('jo')), null)
})

test('directory routing handles date-line viewports without scanning the world', () => {
  const tiles = directoryTilesForBounds({ north: 0.9, south: -0.9, west: 179.1, east: -179.1 }, 1)
  assert.equal(tiles.length, 4)
})

test('haversine distance is exact enough for final radius filtering', () => {
  const meters = haversineDistanceMeters(43.6426, -79.3871, 43.65, -79.39)
  assert.ok(meters > 800 && meters < 900)
})

test('object-store radius search routes, filters, fuzzily matches, and ranks candidates', async () => {
  reset()
  fixtureObjectStore()
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { q: 'cn towr', category: 'landmark' }, candidateLimit: 20
  }, { env })
  assert.equal(result.backend, 'object-store')
  assert.equal(result.index, 'object:2026-08-19')
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.diagnostics.shards, 1)
  assert.equal(result.diagnostics.textProjection, false)
})

test('object-store radius search can prioritize canonical photo candidates without widening hydration', async () => {
  reset()
  fixtureObjectStore()
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    preferredCategories: ['cafe'], candidateLimit: 1, preferPhoto: true
  }, {
    env: { ...env, GLOBAL_LOCATION_RANK_PREFERRED_CATEGORY: '100' }
  })
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.candidateLimit, 1)
  assert.equal(result.diagnostics.photoFirst, true)
})

test('grouped geographic search preserves individual category rankings with one shared decode', async () => {
  for (const projection of [false, true]) {
    reset()
    const { counts, projectionCandidateKey, coreKey } = fixtureObjectStore({ photoOverlay: true })
    const options = { env: projection ? { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey } : env }
    const input = { latitude: 43.65, longitude: -79.39, distanceKm: 25, candidateLimit: 1, preferPhoto: true }
    const grouped = await searchObjectGlobalLocations({ ...input, categories: ['landmark', 'cafe'] }, options)
    assert.equal(grouped.candidates.length, 2)
    if (projection) assert.equal(counts.get(coreKey), 1)
    for (const category of ['landmark', 'cafe']) {
      const individual = await searchObjectGlobalLocations({ ...input, filters: { category } }, options)
      assert.deepEqual(grouped.candidates.filter(row => row.category === category), individual.candidates)
    }
  }
})

test('object-store radius search applies freshly materialized photo metadata before photo-first ranking', async () => {
  reset()
  const { projectionCandidateKey } = fixtureObjectStore({ photoOverlay: true })
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    preferredCategories: ['cafe'], candidateLimit: 1, preferPhoto: true
  }, {
    env: { ...env, GLOBAL_LOCATION_RANK_PREFERRED_CATEGORY: '100', GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey }
  })
  assert.equal(result.candidates[0]?.id, 'loc-2')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  assert.deepEqual(result.diagnostics.photoOverlay, { active: true, photoCount: 1, possibleCount: 2, matchedCount: 1 })
})

test('object-store photo overlay loads only the content-addressed hash shard needed by the candidates', async () => {
  reset()
  const { counts } = fixtureObjectStore({ photoOverlay: true })
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { category: 'cafe' }, candidateLimit: 1, preferPhoto: true
  }, { env })
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  const shardReads = [...counts.keys()].filter((key) => key.startsWith('data/search/photo-overlay-v2/'))
  assert.equal(shardReads.length, 1)
})

test('small photo shards preserve attribution and avoid fetching unrelated photos', async () => {
  reset()
  const entries = Array.from({ length: 100 }, (_, index) => [`photo-${index}`, ['b'.repeat(64), 'mapillary', 'Street attribution', 'https://fixture.invalid', 'CC BY-SA', 800, 600]])
  entries.push(['loc-2', ['a'.repeat(64), 'wikimedia-commons', 'Fixture', 'https://fixture.invalid', 'CC BY', 1200, 800]])
  const { counts, manifest, manifestKey } = fixtureObjectStore({ photoOverlay: true, photoBucketCount: 4096, photoEntries: entries })
  const overlay = await getPhotoSearchOverlay({ manifest, manifestKey, ids: ['loc-2'], env })
  assert.equal(overlay.photos.size, 1)
  assert.deepEqual(overlay.photos.get('loc-2'), entries.at(-1)[1])
  const reads = [...counts.keys()].filter(key => key.startsWith('data/search/photo-overlay-v2/'))
  assert.equal(reads.length, 1)
  assert.match(reads[0], /bucket=298\.json\.br$/)
})

test('photo byte cache retains a small working set larger than the old object-count ceiling', async () => {
  reset()
  const entries = Array.from({ length: 80 }, (_, index) => [`photo-${index}`, ['b'.repeat(64), 'mapillary', 'Fixture', null, 'CC BY-SA', 800, 600]])
  const { counts, manifest, manifestKey } = fixtureObjectStore({ photoOverlay: true, photoBucketCount: 4096, photoEntries: entries })
  const ids = entries.map(entry => entry[0])
  await getPhotoSearchOverlay({ manifest, manifestKey, ids, env })
  const keys = [...counts.keys()].filter(key => key.startsWith('data/search/photo-overlay-v2/'))
  assert.ok(keys.length > 32)
  await getPhotoSearchOverlay({ manifest, manifestKey, ids, env })
  assert.ok(keys.every(key => counts.get(key) === 1), 'Small shards should remain cached, not churn at 32 objects')
})

test('photo byte cache evicts old payloads when its byte budget is exhausted', async () => {
  reset()
  const entries = Array.from({ length: 5 }, (_, index) => [`large-photo-${index}`, ['b'.repeat(64), 'mapillary', 'a'.repeat(350000), null, 'CC BY-SA', 800, 600]])
  const { counts, manifest, manifestKey } = fixtureObjectStore({ photoOverlay: true, photoBucketCount: 4096, photoEntries: entries })
  const options = { manifest, manifestKey, env: { ...env, GLOBAL_LOCATION_PHOTO_OVERLAY_CACHE_BYTES: String(1024 * 1024) } }
  const keyFor = id => { const bucket = (createHash('sha256').update(id).digest().readUInt16BE(0) & 4095).toString(16).padStart(3, '0'); return [...counts.keys()].find(key => key.endsWith(`bucket=${bucket}.json.br`)) }
  for (const [id] of entries) await getPhotoSearchOverlay({ ...options, ids: [id] })
  await getPhotoSearchOverlay({ ...options, ids: [entries.at(-1)[0]] })
  assert.equal(counts.get(keyFor(entries.at(-1)[0])), 1)
  await getPhotoSearchOverlay({ ...options, ids: [entries[0][0]] })
  assert.equal(counts.get(keyFor(entries[0][0])), 2)
})

test('object-store dense text radius search uses compact core and hydrates winner detail', async () => {
  reset()
  const { projectionCandidateKey } = fixtureObjectStore()
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { q: 'cn towr', category: 'landmark' }, candidateLimit: 20
  }, {
    env: { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey }
  })
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.candidates[0]?.slug, 'cn-tower')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'abc')
  assert.equal(result.diagnostics.textProjection, true)
  assert.equal(result.diagnostics.textPruneRerun, false)
  assert.equal(result.diagnostics.decodedCandidates, 2)
})

test('object-store structured radius search reuses compact core and hydrates winner detail', async () => {
  reset()
  const { projectionCandidateKey } = fixtureObjectStore()
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { category: 'landmark' }, candidateLimit: 20
  }, {
    env: { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey }
  })
  assert.deepEqual(result.candidates.map((row) => row.id), ['loc-1'])
  assert.equal(result.candidates[0]?.slug, 'cn-tower')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'abc')
  assert.equal(result.diagnostics.textProjection, true)
  assert.equal(result.diagnostics.textMode, 'core-scan')
  assert.equal(result.diagnostics.decodedCandidates, 2)
})

test('concurrent compact searches share manifest, readiness, decode, and hydration work', async () => {
  reset()
  const { projectionCandidateKey, coreKey, detailKey, counts } = fixtureObjectStore({ delayMs: 10 })
  const projectionEnv = { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey }
  const input = {
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { category: 'landmark' }, candidateLimit: 20
  }
  const results = await Promise.all([
    searchObjectGlobalLocations(input, { env: projectionEnv }),
    searchObjectGlobalLocations(input, { env: projectionEnv }),
    searchObjectGlobalLocations(input, { env: projectionEnv })
  ])
  assert.deepEqual(results.map((result) => result.candidates[0]?.id), ['loc-1', 'loc-1', 'loc-1'])
  assert.equal(counts.get('data/search/active.json'), 1)
  assert.equal(counts.get(projectionCandidateKey), 1)
  assert.equal(counts.get(coreKey), 1)
  assert.equal(counts.get(detailKey), 1)
})

test('object-store text search fails loudly when an activated projection core is missing', async () => {
  reset()
  const { projectionCandidateKey, coreKey } = fixtureObjectStore()
  fixtureObjectStore({ missingKey: coreKey })
  await assert.rejects(
    () => searchObjectGlobalLocations({
      latitude: 43.65, longitude: -79.39, distanceKm: 25,
      filters: { q: 'cn towr' }, candidateLimit: 20
    }, {
      env: { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey }
    }),
    /core is missing/
  )
})

test('object-store viewport uses exact bounds at normal zoom', async () => {
  reset()
  fixtureObjectStore()
  const result = await searchObjectGlobalLocationsInViewport({
    north: 43.74, south: 43.5, west: -79.6, east: -79.2, zoom: 11
  }, { env })
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['loc-1', 'loc-2']))
  assert.equal(result.diagnostics.coarseFallback, undefined)
})

test('object-store viewport applies the photo overlay before selecting map results', async () => {
  reset()
  fixtureObjectStore({ photoOverlay: true })
  const result = await searchObjectGlobalLocationsInViewport({
    north: 43.74, south: 43.5, west: -79.6, east: -79.2, zoom: 11, candidateLimit: 1
  }, { env })
  assert.equal(result.candidates[0]?.id, 'loc-2')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  assert.deepEqual(result.diagnostics.photoOverlay, { active: true, photoCount: 1, possibleCount: 2, matchedCount: 1 })
})

test('dense normal-zoom object-store viewport falls back to bounded coarse map instead of failing budget', async () => {
  reset()
  fixtureObjectStore()
  const result = await searchObjectGlobalLocationsInViewport({
    north: 43.8, south: 43.5, west: -79.6, east: -79.2, zoom: 11
  }, { env })
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['loc-1', 'loc-2']))
  assert.equal(result.diagnostics.coarse, true)
  assert.equal(result.diagnostics.coarseFallback, true)
  assert.equal(result.diagnostics.decodedCandidates, 2)
})

test('viewport compact ranking equals document ranking and only hydrates winners', async () => {
  for (const q of ['', 'cn towr', 'cafe', 'no-such-place']) {
    reset()
    const { counts, geoKey, projectionCandidateKey, coreKey } = fixtureObjectStore({ photoOverlay: true })
    const input = { north: 43.74, south: 43.5, west: -79.6, east: -79.2, zoom: 11, candidateLimit: 1, q }
    const compact = await searchObjectGlobalLocationsInViewport(input, { env: { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: projectionCandidateKey } })
    assert.equal(compact.diagnostics.textProjection, true)
    assert.equal(counts.get(coreKey), 1)
    assert.equal(counts.get(geoKey) || 0, 0)
    const full = await searchObjectGlobalLocationsInViewport(input, { env })
    const fields = ['id', 'slug', 'name', 'category', 'city', 'neighborhood', 'summary', 'description', 'latitude', 'longitude', 'primary_photo', 'distance_m', 'search_score']
    const presentation = rows => rows.map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null])))
    assert.deepEqual(presentation(compact.candidates), presentation(full.candidates))
    if (q === 'cn towr') assert.deepEqual(compact.candidates.map(row => row.id), ['loc-1'])
    if (q === 'no-such-place') assert.deepEqual(compact.candidates, [])
  }
})

test('object-store ID and slug hydration use deterministic hash buckets', async () => {
  reset()
  fixtureObjectStore()
  const ids = await getObjectGlobalLocationsByIds(['loc-1'], { env })
  assert.equal(ids[0]?.id, 'loc-1')
  const bySlug = await getObjectGlobalLocationBySlug('cn-tower', { env })
  assert.equal(bySlug?.id, 'loc-1')
})

test('radius guard rejects world-scale legacy scans before any object-store read', async () => {
  reset()
  fixtureObjectStore()
  await assert.rejects(
    () => searchObjectGlobalLocations({ latitude: 43.65, longitude: -79.39, distanceKm: 20040 }, { env }),
    /capped at 100 km/
  )
})
