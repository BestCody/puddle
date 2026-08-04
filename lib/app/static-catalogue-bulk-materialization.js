import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import {
  CATALOGUE_CATEGORY_MAPPING_VERSION,
  CATALOGUE_NORMALIZATION_VERSION,
  openPlaceRpcPayload
} from './open-place-catalogue.js'
import {
  staticCatalogueSchema,
  unpackStaticDetail,
  unpackStaticPlace,
  unpackStaticProvenance
} from './static-catalogue.js'
import {
  staticCatalogueLocationId,
  staticMaterializedSlug
} from './static-catalogue-id.js'

const gunzipAsync = promisify(gunzip)
const CHECKPOINT_VERSION = 1
const RPC_BATCH_LIMIT = 50
const TILE_KEY_PATTERN = /^\d+\/\d+\/\d+\.json$/
const RELEASE_PATTERN = /^[A-Za-z0-9._-]{1,80}$/

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback))
}

function safeRelease(value) {
  const release = String(value || '').trim()
  if (!RELEASE_PATTERN.test(release)) throw new Error('Static catalogue release is invalid.')
  return release
}

function safeTileKey(value) {
  const key = String(value || '').replace(/\\/g, '/')
  if (isAbsolute(key) || !TILE_KEY_PATTERN.test(key) || key.includes('..')) {
    throw new Error(`Static catalogue tile key is invalid: ${key || '(empty)'}`)
  }
  return key
}

async function readJson(path) {
  const body = await readFile(path)
  const decoded = path.endsWith('.gz') ? await gunzipAsync(body) : body
  return JSON.parse(decoded.toString('utf8'))
}

async function readCatalogueAsset(path) {
  try {
    return await readJson(`${path}.gz`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return readJson(path)
  }
}

function rowsByIdentity(rows, unpack) {
  return new Map((Array.isArray(rows) ? rows : []).flatMap((row) => {
    const value = unpack(row)
    return value?.source && value?.sourcePlaceId
      ? [[`${value.source}:${value.sourcePlaceId}`, value]]
      : []
  }))
}

export function staticCatalogueMaterializationItem(place, {
  release,
  detail = null,
  provenance = null
} = {}) {
  if (!place?.source || !place?.sourcePlaceId) return null
  if (!['overture', 'fsq_os'].includes(place.source)) return null
  const targetLocation = staticCatalogueLocationId(place.source, place.sourcePlaceId)
  const normalized = {
    ...place,
    ...(detail || {}),
    ...(provenance || {}),
    slug: staticMaterializedSlug(place, targetLocation),
    normalizationVersion: CATALOGUE_NORMALIZATION_VERSION,
    categoryMappingVersion: CATALOGUE_CATEGORY_MAPPING_VERSION,
    sourceMetadata: provenance?.sourceMetadata && typeof provenance.sourceMetadata === 'object'
      ? provenance.sourceMetadata
      : {}
  }
  return {
    targetLocation,
    source: normalized.source,
    payload: openPlaceRpcPayload(normalized, {
      releaseId: safeRelease(release),
      regionId: null
    })
  }
}

export async function readStaticCatalogueMaterializationTile(directory, release, tileKey) {
  const safeKey = safeTileKey(tileKey)
  const safeVersion = safeRelease(release)
  const root = join(directory, 'catalogue', 'releases', safeVersion)
  const [deck, details, provenance] = await Promise.all([
    readCatalogueAsset(join(root, 'tiles', safeKey)),
    readCatalogueAsset(join(root, 'details', safeKey)),
    readCatalogueAsset(join(root, 'provenance', safeKey))
  ])
  if (Number(deck?.v) !== staticCatalogueSchema.version) {
    throw new Error(`Deck tile ${safeKey} uses unsupported schema ${deck?.v}.`)
  }
  const detailMap = rowsByIdentity(details?.d, unpackStaticDetail)
  const provenanceMap = rowsByIdentity(provenance?.p, unpackStaticProvenance)
  return (Array.isArray(deck?.p) ? deck.p : []).flatMap((row) => {
    const place = unpackStaticPlace(row)
    if (!place) return []
    const identity = `${place.source}:${place.sourcePlaceId}`
    const item = staticCatalogueMaterializationItem(place, {
      release: safeVersion,
      detail: detailMap.get(identity) || null,
      provenance: provenanceMap.get(identity) || null
    })
    return item ? [item] : []
  })
}

export async function readStaticCatalogueMaterializationPlan(directory) {
  const rootManifest = await readJson(join(directory, 'catalogue', 'manifest.json'))
  if (Number(rootManifest?.schema) !== staticCatalogueSchema.version) {
    throw new Error(`Static catalogue manifest uses unsupported schema ${rootManifest?.schema}.`)
  }
  const release = safeRelease(rootManifest?.release)
  const releaseManifest = await readJson(join(
    directory,
    'catalogue',
    'releases',
    release,
    'manifest.json'
  ))
  if (Number(releaseManifest?.schema) !== staticCatalogueSchema.version) {
    throw new Error(`Static catalogue release uses unsupported schema ${releaseManifest?.schema}.`)
  }
  if (String(releaseManifest?.release || '') !== release) {
    throw new Error('Static catalogue release manifest does not match the root manifest.')
  }
  const tiles = (Array.isArray(releaseManifest?.tiles) ? releaseManifest.tiles : [])
    .map((tile) => safeTileKey(tile?.key))
  if (!tiles.length) throw new Error('Static catalogue release contains no tiles.')
  return { rootManifest, releaseManifest, release, tiles }
}

async function readCheckpoint(path, release) {
  try {
    const checkpoint = await readJson(path)
    if (
      Number(checkpoint?.version) !== CHECKPOINT_VERSION ||
      String(checkpoint?.release || '') !== release
    ) return new Set()
    return new Set((Array.isArray(checkpoint?.completedTiles) ? checkpoint.completedTiles : [])
      .map(safeTileKey))
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set()
    throw error
  }
}

async function writeCheckpoint(path, release, completedTiles) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify({
    version: CHECKPOINT_VERSION,
    release,
    completedTiles: [...completedTiles].sort(),
    updatedAt: new Date().toISOString()
  }))
  await rename(temporary, path)
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export async function bulkMaterializeStaticCatalogue({
  directory = 'dist/static-catalogue',
  apply = false,
  batchSize = RPC_BATCH_LIMIT,
  limit = Number.MAX_SAFE_INTEGER,
  checkpointPath = join(directory, 'materialization-checkpoint.json'),
  resetCheckpoint = false,
  admin = null,
  logger = console
} = {}) {
  const safeBatchSize = boundedInteger(batchSize, RPC_BATCH_LIMIT, 1, RPC_BATCH_LIMIT)
  const safeLimit = boundedInteger(limit, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER)
  const plan = await readStaticCatalogueMaterializationPlan(directory)
  if (apply && !admin) throw new Error('An administrative Supabase client is required with --apply.')
  if (resetCheckpoint) await rm(checkpointPath, { force: true })

  const completedTiles = apply ? await readCheckpoint(checkpointPath, plan.release) : new Set()
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    release: plan.release,
    directory,
    tiles: plan.tiles.length,
    skippedTiles: 0,
    completedTiles: 0,
    places: 0,
    rpcCalls: 0,
    checkpointPath: apply ? checkpointPath : null,
    limited: false
  }

  for (const tileKey of plan.tiles) {
    if (apply && completedTiles.has(tileKey)) {
      summary.skippedTiles += 1
      continue
    }

    const remaining = safeLimit - summary.places
    if (remaining <= 0) {
      summary.limited = true
      break
    }

    const tileItems = await readStaticCatalogueMaterializationTile(directory, plan.release, tileKey)
    const selected = tileItems.slice(0, remaining)
    for (const batch of chunks(selected, safeBatchSize)) {
      if (!batch.length) continue
      if (apply) {
        const result = await admin.rpc('materialize_static_catalogue_locations_v2', { items: batch })
        if (result.error) throw result.error
        if (!Array.isArray(result.data) || result.data.length !== batch.length) {
          throw new Error('Supabase returned an incomplete catalogue materialization result.')
        }
      }
      summary.places += batch.length
      summary.rpcCalls += apply ? 1 : 0
    }

    const tileComplete = selected.length === tileItems.length
    if (apply && tileComplete) {
      completedTiles.add(tileKey)
      await writeCheckpoint(checkpointPath, plan.release, completedTiles)
      summary.completedTiles += 1
    } else if (!apply) {
      summary.completedTiles += 1
    }

    logger.log(
      `${apply ? 'Materialized' : 'Would materialize'} ${selected.length} places from ${tileKey}.`
    )

    if (!tileComplete || summary.places >= safeLimit) {
      summary.limited = !tileComplete || summary.places >= safeLimit
      break
    }
  }

  return summary
}

export const staticCatalogueBulkMaterializationLimits = Object.freeze({
  checkpointVersion: CHECKPOINT_VERSION,
  rpcBatchLimit: RPC_BATCH_LIMIT
})
