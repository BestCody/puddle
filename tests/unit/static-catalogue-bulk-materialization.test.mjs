import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  bulkMaterializeStaticCatalogue,
  readStaticCatalogueMaterializationTile,
  staticCatalogueBulkMaterializationLimits
} from '../../lib/app/static-catalogue-bulk-materialization.js'
import {
  packStaticDetail,
  packStaticPlace,
  packStaticProvenance,
  staticCatalogueSchema
} from '../../lib/app/static-catalogue.js'

const gzipAsync = promisify(gzip)

async function fixture(places) {
  const directory = await mkdtemp(join(tmpdir(), 'puddle-bulk-materialization-'))
  const release = 'test-release'
  const tileKey = '10/301/385.json'
  const releaseRoot = join(directory, 'catalogue', 'releases', release)
  await Promise.all([
    mkdir(join(releaseRoot, 'tiles', '10', '301'), { recursive: true }),
    mkdir(join(releaseRoot, 'details', '10', '301'), { recursive: true }),
    mkdir(join(releaseRoot, 'provenance', '10', '301'), { recursive: true })
  ])
  await writeFile(join(directory, 'catalogue', 'manifest.json'), JSON.stringify({
    schema: staticCatalogueSchema.version,
    release,
    zoom: 10
  }))
  await writeFile(join(releaseRoot, 'manifest.json'), JSON.stringify({
    schema: staticCatalogueSchema.version,
    release,
    tiles: [{ key: tileKey }]
  }))
  await Promise.all([
    writeFile(
      join(releaseRoot, 'tiles', `${tileKey}.gz`),
      await gzipAsync(Buffer.from(JSON.stringify({
        v: staticCatalogueSchema.version,
        p: places.map((place) => packStaticPlace(place, place.source))
      })))
    ),
    writeFile(
      join(releaseRoot, 'details', `${tileKey}.gz`),
      await gzipAsync(Buffer.from(JSON.stringify({
        v: staticCatalogueSchema.version,
        d: places.map((place) => packStaticDetail(place, place.source))
      })))
    ),
    writeFile(
      join(releaseRoot, 'provenance', `${tileKey}.gz`),
      await gzipAsync(Buffer.from(JSON.stringify({
        v: staticCatalogueSchema.version,
        p: places.map((place) => packStaticProvenance(place, place.source))
      })))
    )
  ])
  return { directory, release, tileKey }
}

function place(index) {
  return {
    source: 'overture',
    sourcePlaceId: `place-${index}`,
    sourceParentPlaceId: null,
    sourceUpdatedAt: '2026-08-04T00:00:00.000Z',
    sourceConfidence: 0.95,
    sourceOperatingStatus: 'open',
    payloadHash: `hash-${index}`,
    sourceMetadata: { fixture: true },
    name: `Place ${index}`,
    kind: 'cafe',
    categoryConfidence: 0.98,
    summary: `A cafe fixture ${index}.`,
    city: 'Toronto',
    neighborhood: 'Downtown',
    region: 'Ontario',
    regionCode: 'ON',
    country: 'Canada',
    countryCode: 'CA',
    postalCode: null,
    addressPublic: `${index} Example Street`,
    latitude: 43.65 + index / 10_000,
    longitude: -79.38 - index / 10_000,
    timezone: 'America/Toronto',
    amenities: ['wifi'],
    accessibility: { wheelchair_accessible: true },
    openingHours: { monday: '09:00-17:00' },
    priceLevel: 2,
    websiteUrl: `https://example.com/${index}`,
    phonePublic: null,
    brandId: null,
    brandName: null,
    duplicateGroupKey: `duplicate-${index}`,
    catalogueGroupKey: `overture:place-${index}`
  }
}

test('bulk tile reader reconstructs complete materialization payloads', async () => {
  const data = await fixture([place(1)])
  const items = await readStaticCatalogueMaterializationTile(
    data.directory,
    data.release,
    data.tileKey
  )
  assert.equal(items.length, 1)
  assert.equal(items[0].source, 'overture')
  assert.equal(items[0].payload.name, 'Place 1')
  assert.equal(items[0].payload.summary, 'A cafe fixture 1.')
  assert.equal(items[0].payload.source_release_id, data.release)
  assert.equal(items[0].payload.source_metadata.fixture, true)
  assert.match(items[0].targetLocation, /^[0-9a-f-]{36}$/)
})

test('bulk operator chunks RPC writes and resumes completed tiles', async () => {
  const data = await fixture([place(1), place(2), place(3)])
  const calls = []
  const admin = {
    async rpc(name, args) {
      calls.push({ name, items: args.items })
      return {
        data: args.items.map((item) => ({
          requestedId: item.targetLocation,
          locationId: item.targetLocation
        })),
        error: null
      }
    }
  }
  const checkpointPath = join(data.directory, 'checkpoint.json')
  const first = await bulkMaterializeStaticCatalogue({
    directory: data.directory,
    apply: true,
    batchSize: 2,
    checkpointPath,
    admin,
    logger: { log() {} }
  })
  assert.equal(staticCatalogueBulkMaterializationLimits.rpcBatchLimit, 50)
  assert.equal(first.places, 3)
  assert.equal(first.rpcCalls, 2)
  assert.deepEqual(calls.map((call) => call.items.length), [2, 1])
  assert.ok(calls.every((call) => call.name === 'materialize_static_catalogue_locations_v2'))

  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'))
  assert.deepEqual(checkpoint.completedTiles, [data.tileKey])

  const second = await bulkMaterializeStaticCatalogue({
    directory: data.directory,
    apply: true,
    batchSize: 2,
    checkpointPath,
    admin,
    logger: { log() {} }
  })
  assert.equal(second.places, 0)
  assert.equal(second.skippedTiles, 1)
  assert.equal(calls.length, 2)
})

test('bulk operator is dry-run safe and does not need Supabase credentials', async () => {
  const data = await fixture([place(1), place(2)])
  const result = await bulkMaterializeStaticCatalogue({
    directory: data.directory,
    apply: false,
    logger: { log() {} }
  })
  assert.equal(result.mode, 'dry-run')
  assert.equal(result.places, 2)
  assert.equal(result.rpcCalls, 0)
  assert.equal(result.checkpointPath, null)
})
