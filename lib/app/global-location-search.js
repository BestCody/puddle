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
import {
  buildOpenSearchLocationSearchBody,
  buildOpenSearchViewportSearchBody,
  getOpenSearchLocationBySlug,
  getOpenSearchLocationsByIds,
  isOpenSearchLocationSearchConfigured,
  openSearchLocationSearchConfig,
  searchOpenSearchLocations,
  searchOpenSearchLocationsInViewport
} from './opensearch-location-search.js'

function selectedBackend(env = process.env) {
  const value = String(env.GLOBAL_LOCATION_SEARCH_BACKEND || 'opensearch').trim().toLowerCase()
  if (value === 'b2' || value === 'opensearch') return value
  throw new Error(`Unsupported GLOBAL_LOCATION_SEARCH_BACKEND ${JSON.stringify(value)}.`)
}

export function globalLocationSearchConfig(env = process.env) {
  return selectedBackend(env) === 'b2' ? b2GlobalLocationSearchConfig(env) : openSearchLocationSearchConfig(env)
}

export function isGlobalLocationSearchConfigured(env = process.env) {
  return selectedBackend(env) === 'b2' ? isB2GlobalLocationSearchConfigured(env) : isOpenSearchLocationSearchConfigured(env)
}

// These exports preserve the migration-time unit-test/debug surface for the retired OpenSearch query DSL.
export const buildGlobalLocationSearchBody = buildOpenSearchLocationSearchBody
export const buildGlobalLocationViewportSearchBody = buildOpenSearchViewportSearchBody
export { normalizeGlobalLocationViewport, viewportLocationLimit }

export async function searchGlobalLocations(input, options = {}) {
  const env = options.env || process.env
  return selectedBackend(env) === 'b2'
    ? searchB2GlobalLocations(input, options)
    : searchOpenSearchLocations(input, options)
}

export async function searchGlobalLocationsInViewport(input, options = {}) {
  const env = options.env || process.env
  return selectedBackend(env) === 'b2'
    ? searchB2GlobalLocationsInViewport(input, options)
    : searchOpenSearchLocationsInViewport(input, options)
}

export async function getGlobalLocationBySlug(slug, options = {}) {
  const env = options.env || process.env
  return selectedBackend(env) === 'b2'
    ? getB2GlobalLocationBySlug(slug, options)
    : getOpenSearchLocationBySlug(slug, options)
}

export async function getGlobalLocationsByIds(ids = [], options = {}) {
  const env = options.env || process.env
  return selectedBackend(env) === 'b2'
    ? getB2GlobalLocationsByIds(ids, options)
    : getOpenSearchLocationsByIds(ids, options)
}
