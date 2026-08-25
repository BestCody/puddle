import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import { downloadB2SearchObject } from './b2-search-object-store.js'
import { directoryTilesForBounds, locationSearchRuntimeConfig } from './location-search-shards.js'

const decompressZstd = promisify(zstdDecompress)
const POSTINGS_VERSION = 2
const PREFIX_LENGTH = 3
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ALPHABET_INDEX = new Map([...ALPHABET].map((value, index) => [value, index]))
const MISSING_READY_TTL_MS = 15_000
const READY_CACHE = new Map()

export const TEXT_POSTINGS_INDEX = Object.freeze({
  ID: 0,
  NAME: 1,
  ALIASES: 2,
  CATEGORY: 3,
  CITY: 6,
  NEIGHBORHOOD: 7,
  ADDRESS: 8,
  STATUS: 15,
  NORMALIZED_NAME: 16,
  NORMALIZED_ALIASES: 17,
  NORMALIZED_CATEGORY: 18,
  NORMALIZED_CITY: 19,
  NORMALIZED_NEIGHBORHOOD: 20,
  NORMALIZED_ADDRESS: 21
})

function integer(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)))
}

function plannerId(manifest) {
  const value = String(manifest?.planner?.id || '').trim()
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : ''
}

function postingsBase(manifest) {
  const prefix = String(manifest?.prefix || '').trim().replace(/\/+$/, '')
  const id = plannerId(manifest)
  if (!prefix || !id) return ''
  return `${prefix}/text-postings-v${POSTINGS_VERSION}/${id}`
}

function postingsDigest(geoKey) {
  return createHash('sha256').update(String(geoKey || '')).digest('hex')
}

export function textPostingsReadyKey(manifest, env = process.env) {
  const override = String(env.GLOBAL_LOCATION_TEXT_POSTINGS_READY_KEY || '').trim().replace(/^\/+/, '')
  if (override) return override
  const base = postingsBase(manifest)
  return base ? `${base}/ready.json` : ''
}

export function textPostingsTileKey(manifest, routeObjectKey) {
  const base = postingsBase(manifest)
  return base ? `${base}/tiles/${postingsDigest(routeObjectKey)}.json.zst` : ''
}

function postingsEnabled(env) {
  return String(env.GLOBAL_LOCATION_TEXT_POSTINGS || '1').trim() !== '0'
}

async function parseJsonObject(key, { env, fetchFn, signal, missingOk = false, maxBytes = 1024 * 1024 } = {}) {
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk, maxBytes })
  if (body === null) return null
  return JSON.parse(body.toString('utf8'))
}

async function loadPostingsReady(manifest, manifestKey, { env, fetchFn, signal } = {}) {
  if (!postingsEnabled(env)) return null
  const key = textPostingsReadyKey(manifest, env)
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
    Number(value.postings_version) !== POSTINGS_VERSION ||
    String(value.source_manifest_key || '') !== String(manifestKey || '') ||
    String(value.planner_id || '') !== plannerId(manifest) ||
    Number(value.prefix_length) !== PREFIX_LENGTH ||
    !Number.isInteger(Number(value.detail_chunk_size)) ||
    Number(value.detail_chunk_size) < 64
  ) {
    throw new Error('B2 text-postings readiness metadata does not match the active search manifest.')
  }
  READY_CACHE.set(cacheKey, { at: Date.now(), value })
  return value
}

function prefixIndex(token) {
  if (token.length < PREFIX_LENGTH) return -1
  // Builder-side signatures index exactly the first three characters; hashing
  // beyond that produces codes no posting list will ever contain.
  let value = 0
  for (const character of token.slice(0, PREFIX_LENGTH)) {
    const index = ALPHABET_INDEX.get(character)
    if (index === undefined) return -1
    value = value * ALPHABET.length + index
  }
  return value
}

// Returns null when the query cannot use postings (any token shorter than three
// characters or outside the ASCII alphabet). That is an explicit capability
// boundary: those queries are served by the scan path instead.
export function queryPrefixCodes(query) {
  const tokens = Array.isArray(query?.tokens) ? query.tokens : []
  if (!tokens.length) return null
  const codes = []
  for (const tokenValue of tokens) {
    const code = prefixIndex(String(tokenValue || ''))
    if (code < 0) return null
    codes.push(code)
  }
  return [...new Set(codes)]
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

async function fetchTilePostings(key, { env, fetchFn, signal }) {
  const maxBytes = integer(env.GLOBAL_LOCATION_MAX_OBJECT_BYTES, 16 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024)
  const body = await downloadB2SearchObject(key, { env, fetchFn, signal, missingOk: true, maxBytes })
  if (body === null) return null
  const raw = await decompressZstd(body)
  const maxDecodedBytes = integer(env.GLOBAL_LOCATION_MAX_DECODED_OBJECT_BYTES, 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024)
  if (raw.length > maxDecodedBytes) throw new Error(`Decoded text-postings tile ${key} exceeds the runtime object budget.`)
  const payload = JSON.parse(raw.toString('utf8'))
  if (!Array.isArray(payload) || Number(payload[0]) !== POSTINGS_VERSION || !Array.isArray(payload[1])) {
    throw new Error(`Invalid B2 text-postings tile ${key}.`)
  }
  return payload[1]
}

function routingObjectKeys(manifest, bounds) {
  const directory = manifest?.geo?.directory || {}
  const tileDegrees = Number(directory.tile_degrees || 1)
  const prefix = String(directory.prefix || `${manifest?.prefix || ''}/routing`).replace(/\/+$/, '')
  return directoryTilesForBounds(bounds, tileDegrees).map(([latIndex, lonIndex]) => `${prefix}/${latIndex}/${lonIndex}.json.br`)
}

// Loads routing-tile postings bundles covering the plan. A missing tile while
// the marker is present is a broken derivative and throws loudly.
export async function fetchTextPostingsForPlan(plan, bounds, { manifest, manifestKey, env = process.env, fetchFn = fetch, signal } = {}) {
  const ready = await loadPostingsReady(manifest, manifestKey, { env, fetchFn, signal })
  if (!ready) return null
  const config = locationSearchRuntimeConfig(env)
  const routeKeys = routingObjectKeys(manifest, bounds)
  if (!routeKeys.length || routeKeys.length > config.maxDirectoryTiles) {
    throw new Error('B2 text-postings plan exceeds the routing-tile budget.')
  }
  const selectedKeys = new Set(plan.shards.map((shard) => shard.key))
  const tiles = await mapConcurrent(routeKeys, config.fetchConcurrency, async (routeKey) => {
    const key = textPostingsTileKey(manifest, routeKey)
    const entriesByPack = await fetchTilePostings(key, { env, fetchFn, signal })
    // A missing tile while the marker is present fails loudly instead of
    // silently degrading to a scan path.
    if (!entriesByPack) throw new Error(`B2 text-postings tile is missing: ${key}`)
    return entriesByPack
  })
  const packs = []
  for (const entriesByPack of tiles) {
    for (const [sourceKey, entries] of entriesByPack) {
      if (!selectedKeys.has(sourceKey)) continue
      packs.push({ sourceKey, entries })
    }
  }
  return { ready, packs }
}

// Intersects query prefix codes across the per-pack inverted lists. The result
// is a conservative superset of rows the production scorer can match through
// exact/prefix token branches; every returned ref is re-scored by the caller.
export function intersectPostings(postings, prefixCodes) {
  const refs = []
  for (const pack of postings.packs) {
    const lists = new Array(prefixCodes.length)
    let empty = false
    for (let index = 0; index < prefixCodes.length; index += 1) {
      lists[index] = findList(pack.entries, prefixCodes[index])
      if (!lists[index]) {
        empty = true
        break
      }
    }
    if (empty) continue
    const shortest = lists.reduce((smallest, list) => (list.length < smallest.length ? list : smallest), lists[0])
    for (let cursor = 0; cursor < shortest.length; cursor += 1) {
      const rowIndex = shortest[cursor]
      let present = true
      for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
        if (lists[listIndex] === shortest) continue
        if (!sortedContains(lists[listIndex], rowIndex)) {
          present = false
          break
        }
      }
      if (present) refs.push({ sourceKey: pack.sourceKey, rowIndex })
    }
  }
  return refs
}

function findList(entries, code) {
  let low = 0
  let high = entries.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const entryCode = entries[middle][0]
    if (entryCode === code) return entries[middle][1]
    if (entryCode < code) low = middle + 1
    else high = middle - 1
  }
  return null
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

export function clearTextPostingsCaches() {
  READY_CACHE.clear()
}
