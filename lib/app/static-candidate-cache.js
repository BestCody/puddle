import { fetchNearbyStaticPlaces } from './static-catalogue.js'

const GLOBAL_KEY = '__puddleStaticCandidateCacheV1'
const globalState = globalThis[GLOBAL_KEY] || { entries: new Map(), hits: 0, misses: 0 }
globalThis[GLOBAL_KEY] = globalState

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value)
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback))
}

export function staticCandidateCacheKey({ latitude, longitude, radiusKm, limit, includeDetails = false, baseUrl = '' }) {
  const lat = Math.round(Number(latitude) * 100_000) / 100_000
  const lng = Math.round(Number(longitude) * 100_000) / 100_000
  const radius = Math.round(Number(radiusKm) * 2) / 2
  return `${baseUrl}|${lat}|${lng}|${radius}|${Number(limit) || 0}|${includeDetails ? 1 : 0}`
}

function prune(now, maxEntries) {
  for (const [key, entry] of globalState.entries) {
    if (entry.expiresAt <= now) globalState.entries.delete(key)
  }
  while (globalState.entries.size > maxEntries) {
    const first = globalState.entries.keys().next().value
    if (first === undefined) break
    globalState.entries.delete(first)
  }
}

export async function fetchCachedNearbyStaticPlaces(options, {
  loader = fetchNearbyStaticPlaces,
  ttlMs = boundedNumber(process.env.STATIC_CANDIDATE_CACHE_TTL_MS, 45_000, 1_000, 300_000),
  maxEntries = boundedNumber(process.env.STATIC_CANDIDATE_CACHE_MAX_ENTRIES, 128, 8, 1_024),
  now = Date.now()
} = {}) {
  const key = staticCandidateCacheKey(options)
  prune(now, maxEntries)
  const cached = globalState.entries.get(key)
  if (cached && cached.expiresAt > now) {
    globalState.entries.delete(key)
    globalState.entries.set(key, cached)
    globalState.hits += 1
    const value = await cached.promise
    return {
      ...value,
      candidateCache: {
        status: 'hit',
        ageMs: Math.max(0, now - cached.createdAt),
        entries: globalState.entries.size,
        hits: globalState.hits,
        misses: globalState.misses
      }
    }
  }

  globalState.misses += 1
  const startedAt = performance.now()
  const promise = Promise.resolve().then(() => loader(options))
  const entry = { promise, createdAt: now, expiresAt: now + ttlMs }
  globalState.entries.set(key, entry)
  try {
    const value = await promise
    prune(Date.now(), maxEntries)
    return {
      ...value,
      candidateCache: {
        status: 'miss',
        loadMs: Math.round((performance.now() - startedAt) * 100) / 100,
        entries: globalState.entries.size,
        hits: globalState.hits,
        misses: globalState.misses
      }
    }
  } catch (error) {
    if (globalState.entries.get(key) === entry) globalState.entries.delete(key)
    throw error
  }
}

export function clearStaticCandidateCacheForTests() {
  globalState.entries.clear()
  globalState.hits = 0
  globalState.misses = 0
}
