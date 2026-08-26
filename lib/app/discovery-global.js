import { createHash, randomUUID } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { isOpenAt, parseDiscoveryFilters } from './discovery-filters.js'
import { openPhotoUrlForHash } from '../media/open-photo-url.js'

async function searchGlobalLocations(input, options = {}) {
  const search = await import('./global-location-search.js')
  return search.searchGlobalLocations(input, options)
}

const cachedPublicDiscoverySearch = unstable_cache(
  async (serializedInput) => searchGlobalLocations(JSON.parse(serializedInput), { traceId: null }),
  ['global-discovery-search-v1'],
  { revalidate: 30, tags: ['global-location-search'] }
)

function text(value) {
  return String(value || '').trim().toLowerCase()
}

function description(row) {
  if (String(row.summary || '').trim()) return String(row.summary).trim().slice(0, 500)
  if (String(row.description || '').trim()) return String(row.description).trim().slice(0, 500)
  const kind = String(row.category || row.kind || 'place').replaceAll('_', ' ')
  const locality = [row.city, row.region, row.country].find((value) => String(value || '').trim())
  return `A ${kind}${locality ? ` in ${locality}` : ''}. Details have not yet been verified.`
}

function distanceLabel(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return 'Distance unavailable'
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`
}

function openingHours(row) {
  return row.opening_hours && typeof row.opening_hours === 'object' && !Array.isArray(row.opening_hours)
    ? row.opening_hours
    : {}
}

function matchesRuntimeFilters(row, filters, now = new Date()) {
  if (!filters.openNow) return true
  if (!row.timezone) return false
  return isOpenAt(openingHours(row), row.timezone, now)
}

function card(row) {
  const photo = row.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
  const photoUrl = openPhotoUrlForHash(photo.content_hash)
  const distance = Number(row.distance_m)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const quality = Math.max(0, Math.min(1, Number(row.quality_score || 0)))
  const tier = photoUrl ? 2 : 1
  const category = row.category || row.kind || 'place'
  return {
    content_kind: 'place', content_id: row.id, slug: row.slug || null, title: row.name,
    summary: row.summary || description(row), description_source: row.summary || row.description ? 'canonical' : 'generated_factual',
    category, neighborhood: row.neighborhood || null, city: row.city || null,
    region: row.region || null, region_code: row.region_code || null, country: row.country || null,
    country_code: row.country_code || null, postal_code: row.postal_code || null,
    address_public: row.address || row.address_public || null, brand_id: row.brand_id || null,
    brand_name: row.brand_name || null, source_parent_place_id: row.source_parent_place_id || null,
    duplicate_group_key: row.duplicate_group_key || null, catalogue_group_key: row.catalogue_group_key || null,
    source: 'global_catalogue', starts_at: null, ends_at: null, timezone: row.timezone || 'UTC',
    timezone_verified: Boolean(row.timezone_verified), price_cents: null,
    price_level: Number.isInteger(Number(row.price_level)) ? Number(row.price_level) : null,
    min_age: null, capacity: null, remaining_capacity: null, accessibility: row.accessibility || {},
    amenities: Array.isArray(row.amenities) ? row.amenities : [], opening_hours: openingHours(row),
    latitude: row.latitude, longitude: row.longitude, distance_m: Number.isFinite(distance) ? distance : null,
    open_now: Boolean(row.timezone) && isOpenAt(openingHours(row), row.timezone),
    host_id: null, host_name: null, host_verified: false, published_at: row.updated_at || null,
    popularity_score: Number(row.popularity_score || 0), friend_score: 0, vector_similarity: null,
    embedding_model_version: null, score: Number(row.search_score || 0) + relevance + quality,
    relevance_score: relevance, scoreComponents: { cardTier: tier, contentQuality: quality || (photoUrl ? 0.8 : 0.4), ratingConfidence: 0, relevance },
    reasons: ['Nearby Puddle location'], candidateSources: ['global_location_serving'], loggedVectorSimilarity: null,
    cover_url: photoUrl, photo_url: photoUrl,
    photo_source: photoUrl ? 'licensed_public' : null, photo_provider: photo.provider || null,
    photo_attribution: photo.attribution || null, photo_attribution_url: photo.attribution_url || null,
    photo_license: photo.license || null,
    photo_enrichment_status: photoUrl ? 'matched' : 'unavailable',
    card_tier: tier, card_readiness: photoUrl ? 'photo' : 'no_photo',
    content_quality_score: quality || (photoUrl ? 0.8 : 0.4), recommendation_ready: true,
    rating_score: 0, average_rating: null, confidence_adjusted_rating: 3.8, rating_count: 0, rating_label: null,
    href: row.slug ? `/places/${row.slug}` : null, kindLabel: 'PLACE', distanceLabel: distanceLabel(distance),
    priceLabel: Number.isInteger(Number(row.price_level)) ? '$'.repeat(Number(row.price_level)) : 'Price varies'
  }
}

function duplicateKey(item) {
  if (item.duplicate_group_key) return `duplicate:${item.duplicate_group_key}`
  if (item.catalogue_group_key) return `catalogue:${item.catalogue_group_key}`
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(4)}:${longitude.toFixed(4)}`
    : 'unknown'
  return `coordinate:${text(item.title)}:${coordinates}`
}

function rank(items, interests, limit) {
  const preferred = new Set((interests || []).map(String))
  const sorted = items.map((item, index) => ({
    ...item,
    __index: index,
    __photo: item.photo_url || item.cover_url ? 1 : 0,
    __preference: preferred.has(item.category) ? 1 : 0
  })).sort((a, b) =>
    b.__photo - a.__photo ||
    b.__preference - a.__preference ||
    Number(b.content_quality_score || 0) - Number(a.content_quality_score || 0) ||
    Number(b.popularity_score || 0) - Number(a.popularity_score || 0) ||
    Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity) ||
    a.__index - b.__index
  )
  const ids = new Set()
  const duplicates = new Set()
  const output = []
  for (const item of sorted) {
    const key = duplicateKey(item)
    if (!item.content_id || ids.has(item.content_id) || duplicates.has(key)) continue
    ids.add(item.content_id)
    duplicates.add(key)
    const { __index, __photo, __preference, ...clean } = item
    output.push(clean)
    if (output.length >= limit) break
  }
  return output
}

function idsFromSeenResult(data) {
  if (!Array.isArray(data)) return []
  return data.map((row) => {
    if (typeof row === 'string') return row
    return row?.location_id || row?.locationId || row?.id || null
  }).filter(Boolean)
}

const seenLocationInFlight = new Map()

async function seenLocationIds(session) {
  const userId = String(session?.user?.id || '').trim()
  if (!userId) {
    try {
      const result = await session.supabase.rpc('discovery_seen_locations_v1')
      if (result.error) return []
      return idsFromSeenResult(result.data)
    } catch {
      return []
    }
  }
  const active = seenLocationInFlight.get(userId)
  if (active) return active
  const request = (async () => {
    try {
      const result = await session.supabase.rpc('discovery_seen_locations_v1')
      if (result.error) return []
      return idsFromSeenResult(result.data)
    } catch {
      return []
    }
  })()
  seenLocationInFlight.set(userId, request)
  try {
    return await request
  } finally {
    if (seenLocationInFlight.get(userId) === request) seenLocationInFlight.delete(userId)
  }
}

function emptyFeed(session, filters) {
  return {
    requestId: randomUUID(), items: [], filters, center: null,
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [], recycled: false, emptyReason: 'location_required',
    continuation: { excluded: 0, candidateLimit: 0, hasMore: false },
    rankingVersion: 'global-location-v1', experiment: { experiment: 'global-location-v1', variant: 'control', bucket: 0, holdout: false },
    rejections: [], personalization: { behavioral: true, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: { source: 'global-location-serving', index: null, candidates: 0, timings: { queryMs: 0, totalMs: 0 } }
  }
}

function hasActiveFilters(filters) {
  return Boolean(filters.q || filters.category || filters.amenity || filters.accessible || filters.openNow || /^[1-4]$/.test(filters.price))
}

export async function getGlobalDiscoveryFeed(session, rawFilters = {}, { excludeIds = [], preloadedSeenLocationIds = null } = {}) {
  const started = performance.now()
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return emptyFeed(session, filters)

  const explicitExcludes = [...new Set((excludeIds || []).map(String).filter(Boolean))]
  // History is user-specific, while the B2 search is public catalogue data. Start
  // both reads together; if the first result window is not large enough after
  // removing seen locations, the explicit refill query restores exact semantics.
  const seenStarted = performance.now()
  const seenPromise = (explicitExcludes.length
    ? Promise.resolve([])
    : Array.isArray(preloadedSeenLocationIds)
      ? Promise.resolve(preloadedSeenLocationIds)
      : seenLocationIds(session)
  ).then((value) => ({ value, durationMs: performance.now() - seenStarted }))
  const interests = [...new Set(session.profile?.interests || [])]
  const queryStarted = performance.now()
  const searchInput = {
    latitude,
    longitude,
    distanceKm: filters.distance,
    filters,
    preferredCategories: interests,
    // Select photo-backed candidates before the final card ranker. This keeps
    // high-scoring no-photo rows from consuming the B2 top-K window while
    // retaining the exact same candidate scan and hydration budget.
    preferPhoto: true
  }
  const searchPromise = (explicitExcludes.length
    ? searchGlobalLocations({ ...searchInput, excludeIds: explicitExcludes }, { traceId: session.traceId || null })
    : cachedPublicDiscoverySearch(JSON.stringify(searchInput))
  ).then((value) => ({ value, durationMs: performance.now() - queryStarted }))
  const [{ value: seen, durationMs: seenMs }, { value: initialResult, durationMs: initialSearchMs }] = await Promise.all([seenPromise, searchPromise])
  let searchMs = initialSearchMs
  const excluded = [...new Set([...explicitExcludes, ...seen].map(String).filter(Boolean))]
  const excludedSet = new Set(excluded)
  let result = {
    ...initialResult,
    candidates: initialResult.candidates.filter((row) => !excludedSet.has(String(row?.id || '')))
  }
  // The initial window is large enough for normal decks. A second query is only
  // needed when a user's history consumed that window, and it carries the full
  // exclusion set so the result is identical to the previous serial path.
  if (!explicitExcludes.length && result.candidates.length < filters.limit && seen.length) {
    const refillStarted = performance.now()
    const refill = await searchGlobalLocations({
      latitude,
      longitude,
      distanceKm: filters.distance,
      filters,
      excludeIds: excluded,
      preferredCategories: interests,
      preferPhoto: true
    }, { traceId: session.traceId || null })
    const byId = new Map(result.candidates.map((row) => [String(row?.id || ''), row]))
    for (const row of refill.candidates) if (row?.id && !byId.has(String(row.id))) byId.set(String(row.id), row)
    result = { ...refill, candidates: [...byId.values()] }
    searchMs += performance.now() - refillStarted
  }
  const queryMs = performance.now() - queryStarted
  const candidates = result.candidates.filter((row) => matchesRuntimeFilters(row, filters)).map(card)
  const items = rank(candidates, interests, filters.limit)
  const totalMs = performance.now() - started

  return {
    requestId: randomUUID(),
    impressionKey: createHash('sha256').update(`${Math.floor(Date.now() / 300000)}:${JSON.stringify(filters)}:global`).digest('hex').slice(0, 32),
    items, filters, center: { latitude, longitude },
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [...new Set(items.map((item) => item.category).filter(Boolean))].sort(), recycled: false,
    emptyReason: items.length ? null : hasActiveFilters(filters) ? 'filters' : excluded.length ? 'exhausted' : 'catalogue_sync_pending',
    continuation: { excluded: excluded.length, candidateLimit: result.candidateLimit, hasMore: result.candidates.length >= result.candidateLimit },
    rankingVersion: 'global-location-v1',
    experiment: { experiment: 'global-location-v1', variant: 'control', bucket: 0, holdout: false },
    rejections: [], personalization: { behavioral: Boolean(seen.length), friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      source: 'global-location-serving', index: result.index, candidates: result.candidates.length,
      searchTookMs: result.tookMs, searchTimedOut: result.timedOut,
      timings: {
        queryMs: Math.round(queryMs * 100) / 100,
        searchMs: Math.round(searchMs * 100) / 100,
        seenMs: Math.round(seenMs * 100) / 100,
        totalMs: Math.round(totalMs * 100) / 100
      }
    }
  }
}
