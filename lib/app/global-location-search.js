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

export async function searchGlobalLocations(input, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  return searchB2GlobalLocations(input, options)
}

export async function searchGlobalLocationsInViewport(input, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  return searchB2GlobalLocationsInViewport(input, options)
}

export async function getGlobalLocationBySlug(slug, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  return getB2GlobalLocationBySlug(slug, options)
}

export async function getGlobalLocationsByIds(ids, options = {}) {
  const env = options.env || process.env
  if (!isB2GlobalLocationSearchConfigured(env)) throw new Error('B2 global location search is not configured.')
  return getB2GlobalLocationsByIds(ids, options)
}
