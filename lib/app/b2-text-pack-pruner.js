import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { downloadB2SearchObject } from './b2-search-object-store.js'
import { directoryTilesForBounds, locationSearchRuntimeConfig } from './location-search-shards.js'

const decompressZstd = promisify(zstdDecompress)
const PRUNER_VERSION = 1
const PREFIX_LENGTH = 3
const SIGNATURE_FORMAT = 'prefix3-indices-v1'
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ALPHABET_INDEX = new Map([...ALPHABET].map((value, index) => [value, index]))
const MISSING_READY_TTL_MS = 15_000
const READY_CACHE = new Map()

function plannerId(manifest) {
  const value = String(manifest?.planner?.id || '').trim()
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : ''
}

function prunerBase(manifest) {
  const prefix = String(manifest?.prefix || '').trim().replace(/\/+$/, '')
  const id = plannerId(manifest)
  return prefix && id ? `${prefix}/text-prune-v${PRUNER_VERSION}/${id}` : ''
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

export function textPruneReadyKey(manifest, env = process.env) {
  const override = String(env.GLOBAL_LOCATION_TEXT_PRUNE_READY_KEY || '').trim().replace(/^\/+/, '')
  if (override) return override
  const base = prunerBase(manifest)
  return base ? `${base}/ready.json` : ''
}

export function textPruneRouteKey(manifest, routingObjectKey) {
  const base = prunerBase(manifest)
  return base ? `${base}/routes/${digest(routingObjectKey)}.json.zst` : ''
}

function enabled(env) {
  return String(env.GLOBAL_LOCATION_TEXT_PRUNE || '1').trim() !== '0'
}

async function parseJsonObject(key, { env, fetchFn, signal, missingOk = false, maxBytes = 1024 * 1024 } = {}) {
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk, maxBytes })
  if (body === null) return null
  return JSON.parse(body.toString('utf8'))
}

async function loadReady(manifest, manifestKey, { env, fetchFn, signal } = {}) {
  if (!enabled(env)) return null
  const key = textPruneReadyKey(manifest, env)
  if (!key) return null
  const cacheKey = `${manifestKey || ''}:${key}`
  const cached = READY_CACHE.get(cacheKey)
  if (cached && (cached.value || Date.now() - cached.at < MISSING_READY_TTL_MS)) return cached.value
  const value = await parseJsonObject(key, { env, fetchFn, signal, missingOk: true })
  if (!value) {
    READY_CACHE.set(cacheKey, { at: Date.now(), value: null })
    return null
  }
  if (
    Number(value.schema_version) !== 1 ||
    Number(value.pruner_version) !== PRUNER_VERSION ||
    String(value.source_manifest_key || '') !== String(manifestKey || '') ||
    String(value.planner_id || '') !== plannerId(manifest) ||
    Number(value.prefix_length) !== PREFIX_LENGTH ||
    String(value.signature_format || '') !== SIGNATURE_FORMAT
  ) {
    throw new Error('B2 text-prune readiness metadata does not match the active search manifest.')
  }
  READY_CACHE.set(cacheKey, { at: Date.now(), value })
  return value
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      output[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, run))
  return output
}

function prefixIndex(prefix) {
  if (prefix.length !== PREFIX_LENGTH) return -1
  let value = 0
  for (const character of prefix) {
    const index = ALPHABET_INDEX.get(character)
    if (index === undefined) return -1
    value = value * ALPHABET.length + index
  }
  return value
}

function queryPrefixIndexes(query) {
  const tokens = Array.isArray(query?.tokens) ? query.tokens : []
  if (!tokens.length) return null
  const indexes = []
  for (const tokenValue of tokens) {
    const token = String(tokenValue || '')
    if (token.length < PREFIX_LENGTH) return null
    const index = prefixIndex(token.slice(0, PREFIX_LENGTH))
    if (index < 0) return null
    indexes.push(index)
  }
  return [...new Set(indexes)]
}

function sortedContains(values, needle) {
  let low = 0
  let high = values.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const value = values[middle]
    if (value === needle) return true
    if (value < needle) low = middle + 1
    else high = middle - 1
  }
  return false
}

function signatureContainsAll(signature, indexes) {
  for (const index of indexes) if (!sortedContains(signature, index)) return false
  return true
}

function routeObjectKeys(manifest, bounds) {
  const directory = manifest?.geo?.directory || {}
  const tileDegrees = Number(directory.tile_degrees || 1)
  const prefix = String(directory.prefix || `${manifest?.prefix || ''}/routing`).replace(/\/+$/, '')
  return directoryTilesForBounds(bounds, tileDegrees).map(([latIndex, lonIndex]) => `${prefix}/${latIndex}/${lonIndex}.json.br`)
}

async function fetchRouteSidecar(manifest, routingObjectKey, { env, fetchFn, signal } = {}) {
  const key = textPruneRouteKey(manifest, routingObjectKey)
  if (!key) return null
  const maxBytes = Math.max(64 * 1024, Math.min(8 * 1024 * 1024, Number(env.GLOBAL_LOCATION_TEXT_PRUNE_MAX_ROUTE_BYTES) || 4 * 1024 * 1024))
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk: true, maxBytes })
  if (body === null) return null
  const raw = await decompressZstd(body)
  if (raw.length > 32 * 1024 * 1024) throw new Error(`Decoded text-prune route ${key} exceeds the runtime budget.`)
  const payload = JSON.parse(raw.toString('utf8'))
  if (!Array.isArray(payload) || Number(payload[0]) !== PRUNER_VERSION || !Array.isArray(payload[1])) {
    throw new Error(`Invalid B2 text-prune route ${key}.`)
  }
  return payload[1]
}

function metadataRecord(value) {
  if (!Array.isArray(value) || value.length < 5) return null
  const key = String(value[0] || '')
  const signature = value[1]
  if (!key || !Array.isArray(signature) || signature.some((item) => !Number.isInteger(item) || item < 0 || item >= ALPHABET.length ** PREFIX_LENGTH)) return null
  return {
    key,
    signature,
    maxQuality: Math.max(0, Number(value[2]) || 0),
    maxPopularity: Math.max(0, Number(value[3]) || 0),
    hasPhoto: Boolean(value[4])
  }
}

export async function pruneTextShardPlan(plan, bounds, query, {
  manifest,
  manifestKey,
  weights,
  preferredCategories,
  env = process.env,
  fetchFn = fetch,
  signal
} = {}) {
  const indexes = queryPrefixIndexes(query)
  if (!indexes || !enabled(env)) return null
  const ready = await loadReady(manifest, manifestKey, { env, fetchFn, signal })
  if (!ready) return null

  const config = locationSearchRuntimeConfig(env)
  const routingKeys = routeObjectKeys(manifest, bounds)
  if (!routingKeys.length || routingKeys.length > config.maxDirectoryTiles) return null
  const sidecars = await mapConcurrent(routingKeys, config.fetchConcurrency, (key) => fetchRouteSidecar(manifest, key, { env, fetchFn, signal }))
  // A missing route sidecar while the pruner marker is present is a broken derivative:
  // fail loudly instead of silently degrading to an unpruned scan.
  const missing = routingKeys.filter((key, index) => sidecars[index] === null)
  if (missing.length) throw new Error(`B2 text-prune route sidecars are missing: ${missing.join(', ')}`)

  const metadata = new Map()
  for (const rows of sidecars) {
    for (const value of rows) {
      const record = metadataRecord(value)
      if (!record) throw new Error('Invalid B2 text-prune pack signature.')
      const existing = metadata.get(record.key)
      if (!existing) {
        metadata.set(record.key, record)
      } else {
        existing.maxQuality = Math.max(existing.maxQuality, record.maxQuality)
        existing.maxPopularity = Math.max(existing.maxPopularity, record.maxPopularity)
        existing.hasPhoto ||= record.hasPhoto
      }
    }
  }

  const selected = []
  const omitted = []
  let compressedBytes = 0
  let candidateCount = 0
  for (const shard of plan.shards) {
    const record = metadata.get(String(shard.key))
    // A missing signature is never safe to prune.
    if (!record || signatureContainsAll(record.signature, indexes)) {
      selected.push(shard)
      compressedBytes += Number(shard.bytes) || 0
      candidateCount += Number(shard.count) || 0
    } else {
      omitted.push(record)
    }
  }
  if (!omitted.length) return null

  const weight = weights || {}
  const preferredBonus = preferredCategories?.size ? Math.max(0, Number(weight.preferredCategory) || 0) : 0
  let omittedUpperBound = 0
  for (const record of omitted) {
    // scoreNormalizedTextFields() can return at most 16 for a fuzzy-only name match.
    const upper = 16 +
      record.maxQuality * Math.max(0, Number(weight.quality) || 0) +
      record.maxPopularity * Math.max(0, Number(weight.popularity) || 0) +
      preferredBonus +
      (record.hasPhoto ? Math.max(0, Number(weight.photo) || 0) : 0) +
      Math.max(0, Number(weight.distance) || 0)
    omittedUpperBound = Math.max(omittedUpperBound, upper)
  }

  return {
    ready,
    plan: {
      ...plan,
      shards: selected,
      compressedBytes,
      candidateCount
    },
    selectedShards: selected.length,
    omittedShards: omitted.length,
    omittedUpperBound
  }
}

export function textPrunedTopKIsComplete(candidates, limit, prune) {
  if (!prune || prune.omittedShards <= 0) return true
  if (!Array.isArray(candidates) || candidates.length < limit) return false
  const cutoff = Number(candidates[candidates.length - 1]?.search_score)
  return Number.isFinite(cutoff) && cutoff > Number(prune.omittedUpperBound) + 1e-9
}

export function clearTextPruneCaches() {
  READY_CACHE.clear()
}
