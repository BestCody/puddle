import http from 'node:http'
import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const DEFAULT_PORT = Number(process.env.E2E_GLOBAL_SEARCH_PORT || 39200)
const DEFAULT_BUCKET = process.env.B2_DATA_BUCKET_NAME || 'puddle-e2e-assets'
const DEFAULT_KEY_ID = process.env.B2_DATA_APPLICATION_KEY_ID || 'e2e-key-id'
const DEFAULT_APPLICATION_KEY = process.env.B2_DATA_APPLICATION_KEY || 'e2e-application-key'

// Emulates just enough of the Backblaze B2 native API for the production B2
// location-search runtime to run fully in-process during E2E. Every object
// (routing tiles, packs per tile, id/slug buckets, coarse map tiles) is derived
// deterministically from the supplied documents, so the object graph scales
// with fixtures instead of being hardcoded.

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function hashBucket(value) {
  return sha256Hex(value).slice(0, 3)
}

export function buildObjects(documents, { prefix = 'data/search/schema=v1/snapshot=e2e', plannerId = 'e2e-pack' } = {}) {
  const objects = new Map()
  const setJson = (key, value) => objects.set(key, Buffer.from(JSON.stringify(value)))
  const manifestKey = `${prefix}/manifest.json`
  const routingPrefix = `${prefix}/routing`

  setJson('data/search/active.json', {
    schema_version: 1,
    snapshot: 'e2e',
    manifest_key: manifestKey
  })

  setJson(manifestKey, {
    schema_version: 1,
    snapshot: 'e2e',
    source_snapshot: 'e2e',
    prefix,
    location_count: documents.length,
    published_count: documents.length,
    geo_location_count: documents.length,
    planner: { version: 2, id: plannerId },
    geo: {
      directory: { tile_degrees: 1, prefix: routingPrefix },
      target_candidates: 20000
    },
    geo_map: {
      z0: { tile_degrees: 30, prefix: `${prefix}/geo-map/z0`, max_zoom_exclusive: 5 },
      z1: { tile_degrees: 10, prefix: `${prefix}/geo-map/z1`, max_zoom_exclusive: 8 }
    }
  })

  const br = (value) => brotliCompressSync(Buffer.from(JSON.stringify(value)))

  // One physical pack per 1-degree routing tile, using the same +90/+180
  // directory indexing the runtime's directoryTilesForBounds applies.
  const tiles = new Map()
  for (const document of documents) {
    const la = Math.floor(document.latitude + 90)
    const lo = Math.floor(document.longitude + 180)
    const key = `${la}:${lo}`
    if (!tiles.has(key)) tiles.set(key, [])
    tiles.get(key).push(document)
  }

  for (const [tileKey, docs] of tiles) {
    const [latIndex, lonIndex] = tileKey.split(':').map(Number)
    const packKey = `${prefix}/packs/${latIndex}_${lonIndex}.json.br`
    const body = br(docs)
    objects.set(packKey, body)

    const north = Math.max(...docs.map((d) => d.latitude)) + 0.5
    const south = Math.min(...docs.map((d) => d.latitude)) - 0.5
    const east = Math.max(...docs.map((d) => d.longitude)) + 0.5
    const west = Math.min(...docs.map((d) => d.longitude)) - 0.5
    objects.set(`${routingPrefix}/${latIndex}/${lonIndex}.json.br`, br([
      [packKey, 'pack', north, south, east, west, docs.length, body.length]
    ]))
  }

  // Coarse map tiles for low-zoom viewport serving (same offset indexing).
  const z1Tiles = new Map()
  for (const document of documents) {
    const la = Math.floor((document.latitude + 90) / 10)
    const lo = Math.floor((document.longitude + 180) / 10)
    const key = `${la}:${lo}`
    if (!z1Tiles.has(key)) z1Tiles.set(key, [])
    z1Tiles.get(key).push(document)
  }
  for (const [key, docs] of z1Tiles) {
    const [la, lo] = key.split(':').map(Number)
    objects.set(`${prefix}/geo-map/z1/${la}/${lo}.json.br`, br(docs))
  }

  // Identity + slug buckets use sha256-first-3-hex like the production manifest.
  const idBuckets = new Map()
  const slugBuckets = new Map()
  for (const document of documents) {
    const idBucket = hashBucket(document.id)
    if (!idBuckets.has(idBucket)) idBuckets.set(idBucket, {})
    idBuckets.get(idBucket)[document.id] = document
    if (document.slug) {
      const slugBucket = hashBucket(document.slug)
      if (!slugBuckets.has(slugBucket)) slugBuckets.set(slugBucket, {})
      slugBuckets.get(slugBucket)[document.slug] = document.id
    }
  }
  for (const [bucketKey, value] of idBuckets) objects.set(`${prefix}/id/${bucketKey}.json.br`, br(value))
  for (const [bucketKey, value] of slugBuckets) objects.set(`${prefix}/slug/${bucketKey}.json.br`, br(value))

  return objects
}

export function createB2E2EStub({
  documents,
  port = DEFAULT_PORT,
  bucket = DEFAULT_BUCKET,
  keyId = DEFAULT_KEY_ID,
  applicationKey = DEFAULT_APPLICATION_KEY,
  prefix = 'data/search/schema=v1/snapshot=e2e',
  plannerId = 'e2e-pack'
} = {}) {
  const objects = buildObjects(documents.map((place) => ({
    ...place,
    status: place.status || 'published',
    quality_score: place.quality_score ?? 0.9,
    popularity_score: place.popularity_score ?? 3,
    amenities: Array.isArray(place.amenities) ? place.amenities : [],
    accessible: Boolean(place.accessible),
    aliases: []
  })))

  function currentOrigin() {
    const address = server.address()
    return `http://127.0.0.1:${address.port}`
  }

  function b2Authorize() {
    const origin = currentOrigin()
    return {
      accountId: 'e2e-account',
      authorizationToken: 'e2e-authorization-token',
      applicationKeyExpirationTimestamp: null,
      apiInfo: {
        storageApi: {
          apiUrl: origin,
          downloadUrl: origin,
          allowed: {
            buckets: [{ id: 'bucket-e2e', name: bucket }],
            capabilities: ['readFiles'],
            namePrefix: null
          }
        },
        s3Api: { region: 'e2e' }
      }
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)

    if (url.pathname === '/health') {
      response.writeHead(200).end('ok')
      return
    }

    if (url.pathname.endsWith('/b2_authorize_account')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(b2Authorize(`http://127.0.0.1:${port}`)))
      return
    }

    if (url.pathname.startsWith('/file/')) {
      const marker = `/file/${bucket}/`
      const index = url.pathname.indexOf(marker)
      if (index < 0) {
        response.writeHead(404).end()
        return
      }
      const key = url.pathname.slice(index + marker.length).split('/').map(decodeURIComponent).join('/')
      const body = objects.get(key)
      if (!body) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'Content-Length': String(body.length) })
      response.end(body)
      return
    }

    response.writeHead(404).end()
  })

  return {
    server,
    objects,
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve())),
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

// Bin mode: run directly to keep a listener alive for Playwright runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GLOBAL_LOCATION_FIXTURES } = await import('./global-location-fixture.mjs')
  const documents = GLOBAL_LOCATION_FIXTURES.map((place) => ({
    ...place,
    status: 'published',
    quality_score: 0.9,
    popularity_score: 3
  }))
  const stub = createB2E2EStub({ documents })
  await stub.listen()
  console.log(`b2-e2e-stub listening on ${DEFAULT_PORT}; objects=${stub.objects.size} fixtures=${documents.length}`)
}
