import { b2Configuration, b2Request, deleteB2Object, listB2Objects, putB2Object } from './b2-s3.js'
import {
  detailObjectKey,
  provenanceObjectKey,
  staticCatalogueSchema,
  tileObjectKey,
  unpackStaticDetail,
  unpackStaticPlace,
  unpackStaticProvenance
} from './static-catalogue.js'
import { staticCatalogueLocationId } from './static-catalogue-id.js'
import {
  STATIC_ENRICHMENT_SCHEMA_VERSION,
  emptyEnrichmentStatus,
  enrichmentCheckpointObjectKey,
  enrichmentStatusObjectKey,
  packEnrichmentStatusRow,
  unpackEnrichmentStatusRow
} from './static-catalogue-launch.js'

const TILE_KEY = /^(\d+)\/(\d+)\/(\d+)\.json$/

export function parseStaticTileKey(value) {
  const match = String(value || '').replace(/\\/g, '/').match(TILE_KEY)
  if (!match) throw new Error(`Invalid static catalogue tile key: ${value || '(empty)'}`)
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]), key: `${match[1]}/${match[2]}/${match[3]}.json` }
}

async function readB2Json(key, { config = b2Configuration(), allow404 = false } = {}) {
  if (!config) throw new Error('Backblaze B2 credentials are required.')
  const response = await b2Request({ method: 'GET', key, config })
  if (allow404 && response.status === 404) return null
  if (!response.ok) throw new Error(`Backblaze B2 read failed for ${key}: ${response.status}`)
  return response.json()
}

export async function putB2Json(key, payload, {
  config = b2Configuration(),
  cacheControl = 'no-store'
} = {}) {
  if (!config) throw new Error('Backblaze B2 credentials are required.')
  return putB2Object(key, Buffer.from(JSON.stringify(payload)), {
    contentType: 'application/json; charset=utf-8',
    cacheControl,
    config
  })
}

export async function loadStaticReleasePlan({ release = null, config = b2Configuration() } = {}) {
  if (!config) throw new Error('Backblaze B2 credentials are required.')
  let selectedRelease = String(release || '').trim()
  let rootManifest = null
  if (!selectedRelease) {
    rootManifest = await readB2Json('catalogue/manifest.json', { config })
    selectedRelease = String(rootManifest?.release || '').trim()
  }
  if (!selectedRelease) throw new Error('Static catalogue release is missing.')
  const releaseManifest = await readB2Json(`catalogue/releases/${encodeURIComponent(selectedRelease)}/manifest.json`, { config })
  if (Number(releaseManifest?.schema) !== staticCatalogueSchema.version) {
    throw new Error(`Static catalogue release ${selectedRelease} uses an unsupported schema.`)
  }
  const tiles = (Array.isArray(releaseManifest?.tiles) ? releaseManifest.tiles : [])
    .map((tile) => ({ ...tile, ...parseStaticTileKey(tile?.key) }))
    .sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y)
  if (!tiles.length) throw new Error(`Static catalogue release ${selectedRelease} contains no tiles.`)
  return { release: selectedRelease, rootManifest, releaseManifest, tiles }
}

function keyedRows(rows, unpack) {
  return new Map((Array.isArray(rows) ? rows : []).flatMap((row) => {
    const value = unpack(row)
    return value?.source && value?.sourcePlaceId ? [[`${value.source}:${value.sourcePlaceId}`, value]] : []
  }))
}

export async function readStaticReleaseTile(release, tileValue, { config = b2Configuration() } = {}) {
  const tile = typeof tileValue === 'string' ? parseStaticTileKey(tileValue) : parseStaticTileKey(tileValue?.key)
  const [deck, details, provenance] = await Promise.all([
    readB2Json(tileObjectKey(release, tile), { config }),
    readB2Json(detailObjectKey(release, tile), { config }),
    readB2Json(provenanceObjectKey(release, tile), { config })
  ])
  for (const [label, payload] of [['deck', deck], ['detail', details], ['provenance', provenance]]) {
    if (Number(payload?.v) !== staticCatalogueSchema.version) throw new Error(`${label} tile ${tile.key} uses an unsupported schema.`)
  }
  const detailMap = keyedRows(details?.d, unpackStaticDetail)
  const provenanceMap = keyedRows(provenance?.p, unpackStaticProvenance)
  const places = (Array.isArray(deck?.p) ? deck.p : []).flatMap((row) => {
    const place = unpackStaticPlace(row)
    if (!place) return []
    const identity = `${place.source}:${place.sourcePlaceId}`
    return [{
      ...place,
      ...(detailMap.get(identity) || {}),
      ...(provenanceMap.get(identity) || {}),
      staticLocationId: staticCatalogueLocationId(place.source, place.sourcePlaceId),
      tile
    }]
  })
  return { tile, places }
}

export async function readStaticEnrichmentTile(release, tileValue, { config = b2Configuration() } = {}) {
  const tile = typeof tileValue === 'string' ? parseStaticTileKey(tileValue) : parseStaticTileKey(tileValue?.key)
  const payload = await readB2Json(enrichmentStatusObjectKey(release, tile), { config, allow404: true })
  const statuses = new Map((Array.isArray(payload?.s) ? payload.s : []).flatMap((row) => {
    const status = unpackEnrichmentStatusRow(row)
    return status ? [[status.staticLocationId, status]] : []
  }))
  return { tile, statuses }
}

export async function writeStaticEnrichmentTile(release, tileValue, statuses, { config = b2Configuration() } = {}) {
  const tile = typeof tileValue === 'string' ? parseStaticTileKey(tileValue) : parseStaticTileKey(tileValue?.key)
  const rows = [...statuses.entries()]
    .map(([id, status]) => packEnrichmentStatusRow(id, status))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return putB2Json(enrichmentStatusObjectKey(release, tile), {
    v: STATIC_ENRICHMENT_SCHEMA_VERSION,
    release,
    tile: tile.key,
    updatedAt: new Date().toISOString(),
    s: rows
  }, { config, cacheControl: 'public, max-age=60, stale-while-revalidate=3600' })
}

export async function readStaticWorkerCheckpoint(release, worker, { config = b2Configuration() } = {}) {
  const payload = await readB2Json(enrichmentCheckpointObjectKey(release, worker), { config, allow404: true })
  if (!payload || Number(payload.v) !== 1 || String(payload.release) !== String(release) || String(payload.worker) !== String(worker)) {
    return { completedTiles: new Set(), processedLocations: 0 }
  }
  return {
    completedTiles: new Set((Array.isArray(payload.completedTiles) ? payload.completedTiles : []).map((key) => parseStaticTileKey(key).key)),
    processedLocations: Number(payload.processedLocations || 0)
  }
}

export async function writeStaticWorkerCheckpoint(release, worker, checkpoint, { config = b2Configuration() } = {}) {
  return putB2Json(enrichmentCheckpointObjectKey(release, worker), {
    v: 1,
    release,
    worker,
    completedTiles: [...checkpoint.completedTiles].sort(),
    processedLocations: Number(checkpoint.processedLocations || 0),
    updatedAt: new Date().toISOString()
  }, { config, cacheControl: 'no-store' })
}

export async function resetStaticWorkerCheckpoint(release, worker, { config = b2Configuration() } = {}) {
  return deleteB2Object(enrichmentCheckpointObjectKey(release, worker), { config })
}

export function statusForLocation(statuses, staticLocationId) {
  return statuses.get(String(staticLocationId)) || { staticLocationId: String(staticLocationId), ...emptyEnrichmentStatus() }
}

export async function listAllB2Objects(prefix, { config = b2Configuration() } = {}) {
  const objects = []
  let continuationToken = null
  do {
    const page = await listB2Objects(prefix, { config, continuationToken })
    objects.push(...page.objects)
    continuationToken = page.truncated ? page.nextContinuationToken : null
  } while (continuationToken)
  return objects
}
