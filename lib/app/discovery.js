import { getGlobalDiscoveryFeed } from './discovery-global.js'
import { getRelationalDiscoveryFeed } from './discovery-relational.js'
import { isGlobalLocationSearchConfigured } from './global-location-search.js'

export function useGlobalLocationServing(env = process.env) {
  return String(env.GLOBAL_LOCATION_SEARCH_ENABLED || '').toLowerCase() === 'true' && isGlobalLocationSearchConfigured(env)
}

export async function getDiscoveryFeed(session, filters = {}, options = {}) {
  if (!useGlobalLocationServing()) return getRelationalDiscoveryFeed(session, filters, options)
  try {
    return await getGlobalDiscoveryFeed(session, filters, options)
  } catch (error) {
    const allowFallback = String(process.env.GLOBAL_LOCATION_FALLBACK_TO_SUPABASE || 'true').toLowerCase() === 'true'
    if (!allowFallback) throw error
    console.error(`Global location serving failed; using transitional Supabase fallback: ${error?.message || 'unknown error'}`)
    const feed = await getRelationalDiscoveryFeed(session, filters, options)
    return {
      ...feed,
      fallback: true,
      fallbackReason: 'global_location_serving_failure',
      infrastructure: { ...(feed.infrastructure || {}), requestedSource: 'global-location-serving' }
    }
  }
}
