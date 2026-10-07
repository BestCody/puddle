import {
  globalObjectLocationSearchConfig,
  getObjectGlobalLocationBySlug,
  getObjectGlobalLocationsByIds,
  isGlobalObjectLocationSearchConfigured,
  normalizeGlobalLocationViewport,
  searchObjectGlobalLocations,
  searchObjectGlobalLocationsInViewport,
  viewportLocationLimit
} from './object-location-search.js'

const searchInFlight = new Map()
const viewportInFlight = new Map()
const slugInFlight = new Map()
const idsInFlight = new Map()

// The self-hosted object store is the only runtime catalogue backend.
// Missing storage configuration fails closed rather than substituting another source.

export function globalLocationSearchConfig(env = process.env) {
  return globalObjectLocationSearchConfig(env)
}

export function isGlobalLocationSearchConfigured(env = process.env) {
  return isGlobalObjectLocationSearchConfigured(env)
}

export { normalizeGlobalLocationViewport, viewportLocationLimit }

async function coalesce(map, key, env, fetchFn, load) {
  const active = map.get(key)
  if (active?.env === env && active?.fetchFn === fetchFn) return active.promise
  const promise = load()
  map.set(key, { env, fetchFn, promise })
  try {
    return await promise
  } finally {
    if (map.get(key)?.promise === promise) map.delete(key)
  }
}

export async function searchGlobalLocations(input, options = {}) {
  const env = options.env || process.env
  if (!isGlobalObjectLocationSearchConfigured(env)) throw new Error('Global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  return coalesce(searchInFlight, JSON.stringify(input || {}), env, fetchFn, () => searchObjectGlobalLocations(input, options))
}

export async function searchGlobalLocationsInViewport(input, options = {}) {
  const env = options.env || process.env
  if (!isGlobalObjectLocationSearchConfigured(env)) throw new Error('Global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  return coalesce(viewportInFlight, JSON.stringify(input || {}), env, fetchFn, () => searchObjectGlobalLocationsInViewport(input, options))
}

export async function getGlobalLocationBySlug(slug, options = {}) {
  const env = options.env || process.env
  if (!isGlobalObjectLocationSearchConfigured(env)) throw new Error('Global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  const key = String(slug || '').trim()
  return coalesce(slugInFlight, key, env, fetchFn, () => getObjectGlobalLocationBySlug(key, options))
}

export async function getGlobalLocationsByIds(ids, options = {}) {
  const env = options.env || process.env
  if (!isGlobalObjectLocationSearchConfigured(env)) throw new Error('Global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  const requested = [...new Set((ids || []).map((value) => String(value || '').trim()).filter(Boolean))]
  if (!requested.length) return []
  const sorted = [...requested].sort()
  const rows = await coalesce(idsInFlight, sorted.join(','), env, fetchFn, () => getObjectGlobalLocationsByIds(sorted, options))
  const byId = new Map(rows.map((row) => [String(row?.id || ''), row]))
  return requested.map((id) => byId.get(id)).filter(Boolean)
}
