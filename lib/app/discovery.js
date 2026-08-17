import { randomUUID } from 'node:crypto'
import { getGlobalDiscoveryFeed } from './discovery-global.js'
import { getRelationalDiscoveryFeed } from './discovery-relational.js'
import { isGlobalLocationSearchConfigured } from './global-location-search.js'

const SUCCESS_TTL_MS = 30_000
const STALE_TTL_MS = 5 * 60_000
const FAILURE_WINDOW_MS = 30_000
const CIRCUIT_COOLDOWN_MS = 60_000
const FAILURE_THRESHOLD = 3
const MAX_CACHE_ENTRIES = 250

const globalCircuit = {
  failures: [],
  openUntil: 0
}
const successfulFeeds = new Map()
let nextRelationalFallbackAt = 0

export function useGlobalLocationServing(env = process.env) {
  return String(env.GLOBAL_LOCATION_SEARCH_ENABLED || '').toLowerCase() === 'true' && isGlobalLocationSearchConfigured(env)
}

function cacheKey(session, filters, options) {
  return `${session.user?.id || 'anonymous'}:${JSON.stringify(filters || {})}:${JSON.stringify(options || {})}`
}

function trimCache(now = Date.now()) {
  for (const [key, entry] of successfulFeeds) {
    if (now - entry.createdAt > STALE_TTL_MS) successfulFeeds.delete(key)
  }
  while (successfulFeeds.size > MAX_CACHE_ENTRIES) {
    const oldest = successfulFeeds.keys().next().value
    if (!oldest) break
    successfulFeeds.delete(oldest)
  }
}

function rememberSuccess(key, feed, now = Date.now()) {
  successfulFeeds.delete(key)
  successfulFeeds.set(key, { feed, createdAt: now })
  trimCache(now)
}

function cachedFeed(key, maxAgeMs, now = Date.now()) {
  const entry = successfulFeeds.get(key)
  if (!entry || now - entry.createdAt > maxAgeMs) return null
  successfulFeeds.delete(key)
  successfulFeeds.set(key, entry)
  return entry.feed
}

function recordSuccess() {
  globalCircuit.failures = []
  globalCircuit.openUntil = 0
}

function recordFailure(now = Date.now()) {
  globalCircuit.failures = globalCircuit.failures.filter((time) => now - time <= FAILURE_WINDOW_MS)
  globalCircuit.failures.push(now)
  if (globalCircuit.failures.length >= FAILURE_THRESHOLD) globalCircuit.openUntil = now + CIRCUIT_COOLDOWN_MS
}

function circuitIsOpen(now = Date.now()) {
  return globalCircuit.openUntil > now
}

function allowRelationalFallback(env = process.env, now = Date.now()) {
  const enabled = String(env.GLOBAL_LOCATION_FALLBACK_TO_SUPABASE || 'false').toLowerCase() === 'true'
  if (!enabled) return false
  const minimumInterval = Math.max(1_000, Number(env.GLOBAL_LOCATION_RELATIONAL_FALLBACK_MIN_INTERVAL_MS) || 5_000)
  if (now < nextRelationalFallbackAt) return false
  nextRelationalFallbackAt = now + minimumInterval
  return true
}

function markDegraded(feed, reason, source) {
  return {
    ...feed,
    requestId: randomUUID(),
    fallback: true,
    fallbackReason: reason,
    infrastructure: {
      ...(feed.infrastructure || {}),
      source,
      requestedSource: 'global-location-serving',
      circuitOpen: circuitIsOpen()
    }
  }
}

function emptyDegradedFeed(session, filters, reason) {
  const latitude = Number(filters?.latitude ?? session.profile?.latitude)
  const longitude = Number(filters?.longitude ?? session.profile?.longitude)
  const hasCenter = Number.isFinite(latitude) && Number.isFinite(longitude)
  return {
    requestId: randomUUID(),
    items: [],
    filters,
    center: hasCenter ? { latitude, longitude } : null,
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [],
    recycled: false,
    emptyReason: 'temporarily_unavailable',
    continuation: { excluded: 0, candidateLimit: 0, hasMore: false },
    fallback: true,
    fallbackReason: reason,
    rankingVersion: 'global-location-v1',
    experiment: { experiment: 'global-location-v1', variant: 'control', bucket: 0, holdout: false },
    rejections: [],
    personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      source: 'global-location-degraded',
      requestedSource: 'global-location-serving',
      circuitOpen: circuitIsOpen(),
      candidates: 0,
      timings: { queryMs: 0, totalMs: 0 }
    }
  }
}

async function controlledFailureResponse(session, filters, options, key, reason, error) {
  const now = Date.now()
  const stale = cachedFeed(key, STALE_TTL_MS, now)
  if (stale) return markDegraded(stale, `${reason}_stale_cache`, 'global-location-stale-cache')

  if (allowRelationalFallback(process.env, now)) {
    console.error(`Global location serving failed; one rate-limited relational fallback was admitted: ${error?.message || reason}`)
    try {
      const feed = await getRelationalDiscoveryFeed(session, filters, options)
      return markDegraded(feed, `${reason}_relational_fallback`, 'relational-discovery-fallback')
    } catch (fallbackError) {
      console.error(`Relational discovery fallback also failed: ${fallbackError?.message || 'unknown error'}`)
    }
  }

  console.error(`Global location serving degraded without Postgres failover: ${error?.message || reason}`)
  return emptyDegradedFeed(session, filters, reason)
}

export async function getDiscoveryFeed(session, filters = {}, options = {}) {
  if (!useGlobalLocationServing()) return getRelationalDiscoveryFeed(session, filters, options)

  const key = cacheKey(session, filters, options)
  const now = Date.now()
  trimCache(now)

  if (circuitIsOpen(now)) {
    return controlledFailureResponse(session, filters, options, key, 'global_location_circuit_open', null)
  }

  // A very short fresh cache absorbs duplicate render/navigation requests without
  // changing the user-visible recommendation window.
  const fresh = cachedFeed(key, SUCCESS_TTL_MS, now)
  if (fresh) return markDegraded(fresh, 'global_location_fresh_cache', 'global-location-cache')

  try {
    const feed = await getGlobalDiscoveryFeed(session, filters, options)
    recordSuccess()
    rememberSuccess(key, feed)
    return feed
  } catch (error) {
    recordFailure()
    return controlledFailureResponse(session, filters, options, key, 'global_location_serving_failure', error)
  }
}
