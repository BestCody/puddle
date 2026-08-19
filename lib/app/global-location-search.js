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

export function globalLocationSearchConfig(env = process.env) {
  return b2GlobalLocationSearchConfig(env)
}

export function isGlobalLocationSearchConfigured(env = process.env) {
  return isB2GlobalLocationSearchConfigured(env)
}

export { normalizeGlobalLocationViewport, viewportLocationLimit }

export async function searchGlobalLocations(input, options = {}) {
  return searchB2GlobalLocations(input, options)
}

export async function searchGlobalLocationsInViewport(input, options = {}) {
  return searchB2GlobalLocationsInViewport(input, options)
}

export async function getGlobalLocationBySlug(slug, options = {}) {
  return getB2GlobalLocationBySlug(slug, options)
}

export async function getGlobalLocationsByIds(ids = [], options = {}) {
  return getB2GlobalLocationsByIds(ids, options)
}
