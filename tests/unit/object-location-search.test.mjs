import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { catalogueIndexIdentity } from '../../lib/app/indexed-location-data.js'
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
const temporaryRoots = []

const tower = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'cn-tower', name: 'CN Tower', aliases: [], category: 'landmark',
  latitude: 43.6426, longitude: -79.3871, city: 'Toronto', neighborhood: 'Downtown', address: '290 Bremner Blvd',
  quality_score: 0.95, popularity_score: 4, status: 'published', amenities: ['observation_deck'], accessible: true,
  primary_photo: { content_hash: 'abc' }
}
const cafe = {
  id: '22222222-2222-4222-8222-222222222222', slug: 'nearby-cafe', name: 'Nearby Cafe', aliases: [], category: 'cafe',
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

function fixtureObjectStore({ delayMs = 0, photoOverlay = false, photoEntries = [], locations = [tower, cafe], membership, missingKey = null } = {}) {
  const prefix = 'data/search/schema=v1/snapshot=2026-08-19'
  const plannerId = 'fixture-pack-v1'
  const manifestKey = `${prefix}/manifest.json`
  const geoKey = `${prefix}/geo/r5/852b9b7bfffffff.json.br`
  const outsideRadiusKey = `${prefix}/geo/r8/outside-radius-corner.json.br`
  const denseViewportKey = `${prefix}/geo/r8/dense-viewport-edge.json.br`
  const geoBody = br(locations)
  const projectionBase = `${prefix}/text-projection-v1/${plannerId}`
  const projectionCandidateKey = `${projectionBase}/candidate.json`
  const coreKey = `${projectionBase}/core/${digest(geoKey)}.json.zst`
  const detailKey = `${projectionBase}/detail/${digest(geoKey)}/00000.json.zst`
  const overlayHash = 'a'.repeat(64)
  const manifest = {
    schema_version: 1, snapshot: '2026-08-19', source_snapshot: '2026-08-19', prefix,
    location_count: locations.length, validation: { hashes_sha256: 'f'.repeat(64) },
    planner: { id: plannerId },
    geo: { directory: { tile_degrees: 1, prefix: `${prefix}/routing` } },
    geo_map: {
      z0: { tile_degrees: 30, prefix: `${prefix}/geo-map/z0` },
      z1: { tile_degrees: 10, prefix: `${prefix}/geo-map/z1` }
    }
  }
  const directory = mkdtempSync(join(tmpdir(), 'puddle-index-fixture-'))
  temporaryRoots.push(directory)
  env.GLOBAL_LOCATION_INDEXED_DATA_DIR = directory
  const catalogueIndexPath = join(directory, `catalogue-${catalogueIndexIdentity(manifest, manifestKey)}.sqlite`)
  const database = new DatabaseSync(catalogueIndexPath)
  database.exec(readFileSync(new URL('../../config/location-lookup-schema.sql', import.meta.url), 'utf8'))
  const meta = database.prepare('insert into metadata values(?,?)')
  for (const [key, value] of Object.entries({schema_version:1,complete:1,kind:'catalogue',source_manifest_key:manifestKey,source_ledger_sha256:manifest.validation.hashes_sha256,location_count:locations.length})) meta.run(key,String(value))
  const insert = database.prepare('insert into locations values(?,?,?)')
  for (const row of locations) insert.run(row.id,zstdCompressSync(Buffer.from(JSON.stringify(row))),zstdCompressSync(Buffer.from(JSON.stringify(detail(row)))))
  database.prepare('insert into slugs values(?,?)').run('cn-tower', tower.id)
  database.exec('create unique index location_id_lookup on locations(id); create unique index slug_lookup on slugs(slug);')
  database.close()
  const objects = new Map([
    ['data/search/active.json', Buffer.from(JSON.stringify({ schema_version: 1, snapshot: '2026-08-19', manifest_key: manifestKey }))],
    [manifestKey, Buffer.from(JSON.stringify(manifest))],
    [`${prefix}/routing/133/100.json.br`, br([
      [geoKey, '852b9b7bfffffff', 44, 43, -79, -80, locations.length, geoBody.length],
      // This shard overlaps the radius bounding square but its entire bounding box is outside
      // the 25 km circle. If the planner includes it, the synthetic byte budget is exceeded.
      [outsideRadiusKey, '882b9b000000001', 43.87, 43.84, -79.12, -79.18, 5000, 4 * 1024 * 1024],
      // A dense viewport-only shard that causes a normal-zoom viewport to exceed the fine-plan
      // byte budget, forcing the bounded coarse-map fallback.
      [denseViewportKey, '882b9b000000002', 43.79, 43.75, -79.55, -79.59, 9000, 4 * 1024 * 1024]
    ])],
    [geoKey, geoBody],
    [`${prefix}/geo-map/z1/13/10.json.br`, br([tower, cafe])],
    [projectionCandidateKey, Buffer.from(JSON.stringify({
      schema_version: 1,
      projection_version: 1,
      source_manifest_key: manifestKey,
      planner_id: plannerId,
      detail_chunk_size: 64,
      object_count: 1,
      location_rows: 2
    }))],
    [coreKey, zstd([1, locations.map(core)])],
    [detailKey, zstd([1, 0, locations.map(detail)])]
  ])
  let photoIndexPath = null
  if (photoOverlay) {
    const entries = photoEntries.length ? photoEntries : [['22222222-2222-4222-8222-222222222222', [overlayHash, 'wikimedia-commons', 'Fixture', 'https://fixture.invalid', 'CC BY', 1200, 800]]]
    const photoIdentity = digest(JSON.stringify(entries))
    photoIndexPath = join(directory, `photos-${photoIdentity}.sqlite`)
    const photoDatabase = new DatabaseSync(photoIndexPath)
    photoDatabase.exec('create table metadata(key text primary key,value text not null) without rowid; create table photos(location_id text primary key,photo text not null) without rowid;')
    const photoMeta = photoDatabase.prepare('insert into metadata values(?,?)')
    for (const [key,value] of Object.entries({schema_version:1,complete:1,kind:'photos',data_sha256:photoIdentity,source_manifest_key:manifestKey,photo_count:entries.length})) photoMeta.run(key,String(value))
    const photoInsert = photoDatabase.prepare('insert into photos values(?,?)')
    for (const [id, photo] of entries) photoInsert.run(id,JSON.stringify(photo))
    photoDatabase.close()
    objects.set('data/search/photo-overlay-v1/active.json', Buffer.from(JSON.stringify({
      schema_version: 1,
      overlay_version: 2,
      source_snapshot: '2026-08-19',
      source_manifest_key: manifestKey,
      local_index: { schema_version:1, data_sha256:photoIdentity },
      photo_count: entries.length,
      membership: membership === undefined ? exactMembership(entries.map(entry => entry[0])) : membership
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
  return { projectionCandidateKey, coreKey, detailKey, geoKey, manifest, manifestKey, counts, photoIndexPath, catalogueIndexPath }
}

function reset() {
  clearLocationSearchCaches()
  clearSearchObjectInFlightForTests()
  resetSelfHostObjectClientForTests()
  clearPhotoSearchOverlayCaches()
  clearTextProjectionCaches()
  for (const directory of temporaryRoots.splice(0)) {
    assert.equal(realpathSync(directory), directory)
    assert.ok(directory.startsWith(join(tmpdir(), 'puddle-index-fixture-')))
    rmSync(directory, {recursive:true})
  }
}

function exactMembership(ids) {
  const bytes = Buffer.concat(ids.map(id => Buffer.from(id.replaceAll('-', ''), 'hex')).sort(Buffer.compare))
  return { encoding: 'uuid128-sorted', ids_base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
}

function photoFixtureId(index) {
  return `00000000-0000-4000-9000-${index.toString(16).padStart(12, '0')}`
}

test('exact photo presence preserves radius/viewport ranking and loads metadata only for winners', async () => {
  const locations = Array.from({ length: 40 }, (_, index) => ({ ...cafe,
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    quality_score: index / 40, popularity_score: index, primary_photo: null
  }))
  // The active photo publication is authoritative, not a stale core photo hash.
  locations.at(-1).primary_photo = { content_hash: 'outdated-photo' }
  const entries = locations.filter((_, index) => index % 2 === 0).map(row => [row.id,
    ['a'.repeat(64), 'wikimedia-commons', 'Attribution', 'https://fixture.invalid', 'CC BY', 1200, 800]])
  const fixture = { locations, photoOverlay: true, photoEntries: entries }
  const query = { latitude: 43.65, longitude: -79.39, distanceKm: 25, candidateLimit: 3, preferPhoto: true }
  const viewport = { north: 43.7, south: 43.6, west: -79.5, east: -79.3, zoom: 12, candidateLimit: 3 }
  reset()
  fixtureObjectStore(fixture)
  const documentRadius = await searchObjectGlobalLocations(query, { env })
  const documentViewport = await searchObjectGlobalLocationsInViewport(viewport, { env })
  reset()
  const store = fixtureObjectStore(fixture)
  const options = { env: { ...env, GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY: store.projectionCandidateKey } }
  const optimizedRadius = await searchObjectGlobalLocations(query, options)
  const optimizedViewport = await searchObjectGlobalLocationsInViewport(viewport, options)
  const fields = ['id', 'slug', 'name', 'category', 'city', 'neighborhood', 'address', 'latitude', 'longitude', 'primary_photo', 'distance_m', 'search_score']
  const presentation = rows => rows.map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null])))
  assert.deepEqual(presentation(optimizedRadius.candidates), presentation(documentRadius.candidates))
  assert.deepEqual(presentation(optimizedViewport.candidates), presentation(documentViewport.candidates))
  const photoReads = [...store.counts].filter(([key]) => key.includes('/photo-overlay-v2/objects/'))
  assert.ok(photoReads.length <= query.candidateLimit + viewport.candidateLimit)
  assert.ok(photoReads.length < entries.length)
  assert.equal(optimizedRadius.candidates[0].primary_photo.attribution, 'Attribution')
  reset()
})

test('exact photo membership handles boundaries and rejects corrupt/unsorted IDs', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff']
  const entries = ids.map(id => [id, ['a'.repeat(64), null, null, null, null, null, null]])
  reset()
  const store = fixtureObjectStore({ photoOverlay: true, photoEntries: entries, membership: exactMembership(ids) })
  const pointer = await getPhotoSearchOverlay({ manifest: store.manifest, manifestKey: store.manifestKey, ids: [], env })
  assert.equal(pointer.hasPhoto(ids[0]), true)
  assert.equal(pointer.hasPhoto(ids[1].toUpperCase()), true)
  assert.equal(pointer.hasPhoto('00000000-0000-4000-8000-000000000002'), false)
  assert.equal(pointer.hasPhoto('not-a-uuid'), false)
  for (const broken of [null, { ...exactMembership(ids), sha256: '0'.repeat(64) }, exactMembership([ids[0], ids[0]])]) {
    reset()
    const fixture = fixtureObjectStore({ photoOverlay: true, photoEntries: entries, membership: broken })
    await assert.rejects(getPhotoSearchOverlay({ manifest: fixture.manifest, manifestKey: fixture.manifestKey, env }), /required|checksum|unique and sorted/)
  }
  reset()
})

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
  assert.deepEqual(result.candidates.map((row) => row.id), ['11111111-1111-4111-8111-111111111111'])
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
  assert.deepEqual(result.candidates.map((row) => row.id), ['11111111-1111-4111-8111-111111111111'])
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
  assert.equal(result.candidates[0]?.id, '22222222-2222-4222-8222-222222222222')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  assert.deepEqual(result.diagnostics.photoOverlay, { active: true, photoCount: 1, possibleCount: 1, matchedCount: 1 })
})

test('photo metadata is a keyed local read, not one object download per winning photo', async () => {
  reset()
  const { counts } = fixtureObjectStore({ photoOverlay: true })
  const result = await searchObjectGlobalLocations({
    latitude: 43.65, longitude: -79.39, distanceKm: 25,
    filters: { category: 'cafe' }, candidateLimit: 1, preferPhoto: true
  }, { env })
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  const shardReads = [...counts.keys()].filter((key) => key.startsWith('data/search/photo-overlay-v2/'))
  assert.equal(shardReads.length, 0)
})

test('keyed photo reads preserve attribution without decoding unrelated records', async () => {
  reset()
  const entries = Array.from({ length: 100 }, (_, index) => [photoFixtureId(index), ['b'.repeat(64), 'mapillary', 'Street attribution', 'https://fixture.invalid', 'CC BY-SA', 800, 600]])
  entries.push(['22222222-2222-4222-8222-222222222222', ['a'.repeat(64), 'wikimedia-commons', 'Fixture', 'https://fixture.invalid', 'CC BY', 1200, 800]])
  const { counts, manifest, manifestKey, photoIndexPath } = fixtureObjectStore({ photoOverlay: true, photoEntries: entries })
  const db = new DatabaseSync(photoIndexPath)
  db.prepare('update photos set photo=? where location_id=?').run('malformed unselected JSON', entries[0][0])
  db.close()
  const overlay = await getPhotoSearchOverlay({ manifest, manifestKey, ids: ['22222222-2222-4222-8222-222222222222'], env })
  assert.equal(overlay.photos.size, 1)
  assert.deepEqual(overlay.photos.get('22222222-2222-4222-8222-222222222222'), entries.at(-1)[1])
  const reads = [...counts.keys()].filter(key => key.startsWith('data/search/photo-overlay-v2/'))
  assert.equal(reads.length, 0)
})

test('a photo index aligned to another catalogue fails closed instead of loading shards', async () => {
  reset()
  const {manifest,manifestKey,photoIndexPath} = fixtureObjectStore({photoOverlay:true})
  const db = new DatabaseSync(photoIndexPath)
  db.prepare('update metadata set value=? where key=?').run('another-catalogue', 'source_manifest_key')
  db.close()
  await assert.rejects(getPhotoSearchOverlay({manifest,manifestKey,ids:[cafe.id],env}), /does not match its active source/)
})

test('missing local photo index remains an error instead of a fallback download', async () => {
  reset()
  const {manifest,manifestKey,photoIndexPath} = fixtureObjectStore({photoOverlay:true})
  rmSync(photoIndexPath)
  await assert.rejects(getPhotoSearchOverlay({manifest,manifestKey,ids:[cafe.id],env}), /unable to open database/)
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
  assert.deepEqual(result.candidates.map((row) => row.id), ['11111111-1111-4111-8111-111111111111'])
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
  assert.deepEqual(result.candidates.map((row) => row.id), ['11111111-1111-4111-8111-111111111111'])
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
  assert.deepEqual(results.map((result) => result.candidates[0]?.id), ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'])
  assert.equal(counts.get('data/search/active.json'), 1)
  assert.equal(counts.get(projectionCandidateKey), 1)
  assert.equal(counts.get(coreKey), 1)
  assert.equal(counts.get(detailKey) || 0, 0)
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
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']))
  assert.equal(result.diagnostics.coarseFallback, undefined)
})

test('object-store viewport applies the photo overlay before selecting map results', async () => {
  reset()
  fixtureObjectStore({ photoOverlay: true })
  const result = await searchObjectGlobalLocationsInViewport({
    north: 43.74, south: 43.5, west: -79.6, east: -79.2, zoom: 11, candidateLimit: 1
  }, { env })
  assert.equal(result.candidates[0]?.id, '22222222-2222-4222-8222-222222222222')
  assert.equal(result.candidates[0]?.primary_photo?.content_hash, 'a'.repeat(64))
  assert.deepEqual(result.diagnostics.photoOverlay, { active: true, photoCount: 1, possibleCount: 1, matchedCount: 1 })
})

test('dense normal-zoom object-store viewport falls back to bounded coarse map instead of failing budget', async () => {
  reset()
  fixtureObjectStore()
  const result = await searchObjectGlobalLocationsInViewport({
    north: 43.8, south: 43.5, west: -79.6, east: -79.2, zoom: 11
  }, { env })
  assert.deepEqual(new Set(result.candidates.map((row) => row.id)), new Set(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']))
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
    if (q === 'cn towr') assert.deepEqual(compact.candidates.map(row => row.id), ['11111111-1111-4111-8111-111111111111'])
    if (q === 'no-such-place') assert.deepEqual(compact.candidates, [])
  }
})

test('ID and slug details use the same completed index without catalogue bucket downloads', async () => {
  reset()
  const {counts} = fixtureObjectStore()
  const ids = await getObjectGlobalLocationsByIds(['11111111-1111-4111-8111-111111111111'], { env })
  assert.equal(ids[0]?.id, '11111111-1111-4111-8111-111111111111')
  const bySlug = await getObjectGlobalLocationBySlug('cn-tower', { env })
  assert.equal(bySlug?.id, '11111111-1111-4111-8111-111111111111')
  assert.ok([...counts.keys()].every(key => !key.includes('/id/') && !key.includes('/slug/')))
})

test('keyed details preserve requested order, missing records, and historical slug aliases', async () => {
  reset()
  const { catalogueIndexPath } = fixtureObjectStore()
  const db = new DatabaseSync(catalogueIndexPath)
  db.prepare('insert into slugs values(?,?)').run('historic-tower', tower.id)
  db.close()
  const rows = await getObjectGlobalLocationsByIds([cafe.id, 'missing', tower.id, cafe.id], { env })
  assert.deepEqual(rows, [cafe, tower])
  assert.deepEqual(await getObjectGlobalLocationBySlug('historic-tower', { env }), tower)
  assert.equal(await getObjectGlobalLocationBySlug("' OR 1=1 --", { env }), null)
})

test('missing, incomplete, and mismatched keyed catalogues fail without downloading ID buckets', async () => {
  for (const failure of ['missing', 'complete', 'source_manifest_key']) {
    reset()
    const { catalogueIndexPath, counts } = fixtureObjectStore()
    if (failure === 'missing') rmSync(catalogueIndexPath)
    else {
      const db = new DatabaseSync(catalogueIndexPath)
      db.prepare('update metadata set value=? where key=?').run('invalid', failure)
      db.close()
    }
    await assert.rejects(() => getObjectGlobalLocationsByIds([tower.id], { env }))
    assert.ok([...counts.keys()].every(key => !key.includes('/id/')))
  }
})

test('keyed hydration decodes only selected records and refuses the wrong identity', async () => {
  reset()
  const { catalogueIndexPath } = fixtureObjectStore()
  const db = new DatabaseSync(catalogueIndexPath)
  db.prepare('update locations set document=? where id=?').run(zstd(cafe), tower.id)
  db.close()
  assert.deepEqual(await getObjectGlobalLocationsByIds([cafe.id], { env }), [cafe])
  await assert.rejects(() => getObjectGlobalLocationsByIds([tower.id], { env }), /wrong location identity/)
  await assert.rejects(() => getObjectGlobalLocationBySlug('cn-tower', { env }), /wrong location identity/)
})

test('radius guard rejects world-scale legacy scans before any object-store read', async () => {
  reset()
  fixtureObjectStore()
  await assert.rejects(
    () => searchObjectGlobalLocations({ latitude: 43.65, longitude: -79.39, distanceKm: 20040 }, { env }),
    /capped at 100 km/
  )
})
