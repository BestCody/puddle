import {
  b2GlobalLocationSearchConfig,
  getB2GlobalLocationBySlug,
  getB2GlobalLocationsByIds,
  isB2GlobalLocationSearchConfigured,
  normalizeGlobalLocationViewport,
  searchB2GlobalLocations,
  searchB2GlobalLocationsInViewport,
  viewportLocationLimit
} from './b2-location-search.js'

const searchInFlight = new Map()
const viewportInFlight = new Map()
const slugInFlight = new Map()
const idsInFlight = new Map()

// B2 is the only runtime location-serving backend. There is deliberately no
// backend switch and no legacy fallback: a missing/misconfigured B2 credential
// source fails closed at request time instead of resurrecting a retired system.

export function globalLocationSearchConfig(env = process.env) {
  return b2GlobalLocationSearchConfig(env)
}

export function isGlobalLocationSearchConfigured(env = process.env) {
  return isB2GlobalLocationSearchConfigured(env)
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
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  return coalesce(searchInFlight, JSON.stringify(input || {}), env, fetchFn, () => searchB2GlobalLocations(input, options))
}

export async function searchGlobalLocationsInViewport(input, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  return coalesce(viewportInFlight, JSON.stringify(input || {}), env, fetchFn, () => searchB2GlobalLocationsInViewport(input, options))
}

export async function getGlobalLocationBySlug(slug, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  const key = String(slug || '').trim()
  return coalesce(slugInFlight, key, env, fetchFn, () => getB2GlobalLocationBySlug(key, options))
}

export async function getGlobalLocationsByIds(ids, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  const fetchFn = options.fetchFn || globalThis.fetch
  const requested = [...new Set((ids || []).map((value) => String(value || '').trim()).filter(Boolean))]
  if (!requested.length) return []
  const sorted = [...requested].sort()
  const rows = await coalesce(idsInFlight, sorted.join(','), env, fetchFn, () => getB2GlobalLocationsByIds(sorted, options))
  const byId = new Map(rows.map((row) => [String(row?.id || ''), row]))
  return requested.map((id) => byId.get(id)).filter(Boolean)
}
