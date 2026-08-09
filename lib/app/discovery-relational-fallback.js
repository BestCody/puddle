import { createHash, randomUUID } from 'node:crypto'
import { isOpenAt, parseDiscoveryFilters } from './discovery-filters.js'

const PRIMARY_QUERY_LIMIT = 120
const OPEN_PHOTO_PROVIDERS = new Set(['wikimedia-commons', 'mapillary', 'kartaview'])

function text(value) {
  return String(value || '').trim().toLowerCase()
}

function publicMediaUrl(supabase, value) {
  if (!value) return null
  if (/^https?:\/\//i.test(String(value)) || String(value).startsWith('/')) return String(value)
  return supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function isBackblazeUrl(value) {
  if (!value) return false
  try {
    const host = new URL(String(value)).hostname.toLowerCase()
    return host === 'backblazeb2.com' || host.endsWith('.backblazeb2.com')
  } catch {
    return false
  }
}

function relationalPhotoUrl(session, row) {
  const candidate = row.photo_url || publicMediaUrl(session.supabase, row.cover_path)
  if (!candidate) return null
  if (!isBackblazeUrl(candidate)) return candidate
  return OPEN_PHOTO_PROVIDERS.has(String(row.photo_provider || ''))
    ? `/api/location-open-photo/${encodeURIComponent(String(row.id))}`
    : null
}

function description(row) {
  if (String(row.summary || '').trim()) return String(row.summary).trim().slice(0, 500)
  const kind = String(row.kind || 'place').replaceAll('_', ' ')
  const locality = [row.city, row.region, row.country].find((value) => String(value || '').trim())
  return `A ${kind}${locality ? ` in ${locality}` : ''}. Details have not yet been verified.`
}

function distanceLabel(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return 'Distance unavailable'
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`
}

function matches(row, filters, now = new Date()) {
  const hours = row.opening_hours || {}
  const accessibility = row.accessibility || {}
  const amenities = row.amenities || []
  const haystack = text(`${row.name || ''} ${row.summary || ''} ${row.kind || ''} ${amenities.join(' ')}`)
  if (filters.q && !haystack.includes(filters.q)) return false
  if (filters.category && row.kind !== filters.category) return false
  if (/^[1-4]$/.test(filters.price) && Number(row.price_level || 0) !== Number(filters.price)) return false
  if (filters.amenity && !amenities.some((item) => text(item).includes(filters.amenity))) return false
  if (filters.accessible && !accessibility.wheelchair_accessible && !accessibility.step_free) return false
  if (filters.openNow && (!row.timezone || !isOpenAt(hours, row.timezone, now))) return false
  return true
}

function card(session, row) {
  const photoUrl = relationalPhotoUrl(session, row)
  const distance = Number(row.distance_m)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const googlePlaceId = row.google_place_id || null
  const googleClientLookup = !photoUrl && !googlePlaceId && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
  const hasGoogleFallback = Boolean(googlePlaceId || googleClientLookup)
  const tier = photoUrl ? 3 : hasGoogleFallback ? 2 : 1
  return {
    content_kind: 'place', content_id: row.id, slug: row.slug || null, title: row.name,
    summary: row.summary || description(row), description_source: row.summary ? 'location_summary' : 'generated_factual',
    category: row.kind, neighborhood: row.neighborhood || null, city: row.city || null,
    region: row.region || null, region_code: row.region_code || null, country: row.country || null,
    country_code: row.country_code || null, postal_code: row.postal_code || null,
    address_public: row.address_public || null, brand_id: row.brand_id || null,
    brand_name: row.brand_name || null, source_parent_place_id: row.source_parent_place_id || null,
    duplicate_group_key: row.duplicate_group_key || null, catalogue_group_key: row.catalogue_group_key || null,
    source: row.source || 'import', starts_at: null, ends_at: null, timezone: row.timezone || 'UTC',
    timezone_verified: Boolean(row.timezone_verified), price_cents: null,
    price_level: Number.isInteger(Number(row.price_level)) ? Number(row.price_level) : null,
    min_age: null, capacity: null, remaining_capacity: null, accessibility: row.accessibility || {},
    amenities: row.amenities || [], opening_hours: row.opening_hours || {}, latitude: row.latitude,
    longitude: row.longitude, distance_m: Number.isFinite(distance) ? distance : null,
    open_now: Boolean(row.timezone) && isOpenAt(row.opening_hours || {}, row.timezone),
    host_id: null, host_name: null, host_verified: false, published_at: row.published_at || row.updated_at || null,
    popularity_score: 0, friend_score: 0, vector_similarity: null, embedding_model_version: null,
    score: relevance, relevance_score: relevance,
    scoreComponents: { cardTier: tier, contentQuality: photoUrl ? 0.8 : 0.4, ratingConfidence: 0, relevance },
    reasons: ['Nearby Puddle location'], candidateSources: ['supabase_relational'], loggedVectorSimilarity: null,
    cover_url: photoUrl, photo_url: photoUrl, has_real_photo: Boolean(photoUrl),
    photo_source: row.cover_path ? 'puddle_media' : photoUrl ? 'licensed_public' : null,
    photo_provider: row.cover_path ? 'puddle' : row.photo_provider || null,
    photo_attribution: row.photo_attribution || null, photo_attribution_url: row.photo_attribution_url || null,
    photo_license: row.photo_license || null,
    photo_enrichment_status: photoUrl ? 'matched' : hasGoogleFallback ? 'pending' : 'no_match',
    google_place_id: googlePlaceId, google_place_match_score: row.google_place_match_score ?? null,
    google_photo_proxy_url: googlePlaceId ? `/api/location-google-photo/${encodeURIComponent(String(row.id))}` : null,
    google_client_lookup: googleClientLookup,
    google_lookup_min_score: null,
    card_tier: tier, card_readiness: photoUrl ? 'photo' : hasGoogleFallback ? 'google' : 'fallback',
    content_quality_score: photoUrl ? 0.8 : 0.4, recommendation_ready: true,
    rating_score: 0, average_rating: null, confidence_adjusted_rating: 3.8, rating_count: 0, rating_label: null,
    href: row.slug ? `/places/${row.slug}` : null, kindLabel: 'PLACE', distanceLabel: distanceLabel(distance),
    priceLabel: Number.isInteger(Number(row.price_level)) ? '$'.repeat(Number(row.price_level)) : 'Price varies',
    static_catalogue_ephemeral: false, static_catalogue_source: null, static_catalogue_source_place_id: null,
    static_ref: null, category_placeholder_url: null
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
  return `fallback:${text(item.title ?? item.name)}:${coordinates}`
}

function rank(items, interests, limit) {
  const preferred = new Set((interests || []).map(String))
  const sorted = items.map((item, index) => ({
    ...item, __index: index,
    __photo: item.photo_url || item.cover_url || item.has_real_photo ? 2 : item.google_place_id || item.google_client_lookup ? 1 : 0,
    __preference: preferred.has(item.category) ? 1 : 0
  })).sort((a, b) =>
    b.__photo - a.__photo || b.__preference - a.__preference ||
    Number(b.card_tier || 0) - Number(a.card_tier || 0) ||
    Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity) || a.__index - b.__index
  )
  const ids = new Set()
  const duplicates = new Set()
  const output = []
  for (const item of sorted) {
    const key = duplicateKey(item)
    if (ids.has(item.content_id) || duplicates.has(key)) continue
    ids.add(item.content_id)
    duplicates.add(key)
    const { __index, __photo, __preference, ...clean } = item
    output.push(clean)
    if (output.length >= limit) break
  }
  return output
}

function emptyFeed(session, filters) {
  return {
    requestId: randomUUID(), items: [], filters, center: null,
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [], recycled: false, emptyReason: 'location_required',
    continuation: { excluded: 0, candidateLimit: 0, hasMore: false },
    fallback: false, fallbackReason: null, rankingVersion: 'supabase-relational-v1',
    experiment: { experiment: 'supabase-relational-v1', variant: 'control', bucket: 0, holdout: false },
    rejections: [], personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      catalogue: 'supabase-primary', staticRelease: null, staticFetched: 0, staticServed: 0,
      relationalServed: 0, staticMediaResolvable: 0, staticMaterialized: 0, staticTilesLoaded: 0,
      staticTilesRequested: 0, googleUiKitEligible: 0, overlayRpc: 'r2_discovery_overlay_v1',
      candidateCache: { status: 'not-applicable' }, timings: { catalogueMs: 0, overlayMs: 0, totalMs: 0 }
    }
  }
}

export async function getRelationalDiscoveryFeed(session, rawFilters = {}, { excludeIds = [] } = {}) {
  const started = performance.now()
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return emptyFeed(session, filters)

  const continuationExcluded = new Set((excludeIds || []).map(String))
  const overlayStarted = performance.now()
  const [result, seenResult] = await Promise.all([
    session.supabase.rpc('r2_discovery_overlay_v1', {
      static_ids: [], center_lat: latitude, center_lng: longitude,
      radius_m: Math.round(filters.distance * 1000), max_rows: PRIMARY_QUERY_LIMIT
    }),
    session.supabase.rpc('discovery_seen_locations_v1')
  ])
  if (result.error) throw result.error
  const overlayMs = performance.now() - overlayStarted
  const overlay = result.data || { dismissedIds: [], interests: [], locations: [] }
  const rawRows = overlay.locations || []
  const seenRows = seenResult.error ? [] : seenResult.data || []
  const excluded = new Set([
    ...continuationExcluded,
    ...seenRows.map((row) => String(row.id))
  ])
  const excludedDuplicateKeys = new Set([
    ...seenRows.map((row) => duplicateKey(row)),
    ...rawRows.filter((row) => excluded.has(String(row.id))).map((row) => duplicateKey(row))
  ])
  const candidates = rawRows
    .filter((row) => !excluded.has(String(row.id)))
    .filter((row) => !excludedDuplicateKeys.has(duplicateKey(row)))
    .filter((row) => matches(row, filters))
    .map((row) => card(session, row))
  const interests = [...new Set([...(session.profile?.interests || []), ...(overlay.interests || [])])]
  const items = rank(candidates, interests, filters.limit)
  const totalMs = performance.now() - started
  const distinctExcludedCount = new Set([...excluded, ...excludedDuplicateKeys]).size

  return {
    requestId: randomUUID(),
    impressionKey: createHash('sha256').update(`${Math.floor(Date.now() / 300000)}:${JSON.stringify(filters)}:supabase`).digest('hex').slice(0, 32),
    items, filters, center: { latitude, longitude },
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [...new Set(items.map((item) => item.category).filter(Boolean))].sort(),
    recycled: false,
    emptyReason: items.length ? null : distinctExcludedCount ? 'exhausted' : 'catalogue_sync_pending',
    continuation: {
      excluded: distinctExcludedCount,
      candidateLimit: PRIMARY_QUERY_LIMIT,
      hasMore: rawRows.length >= PRIMARY_QUERY_LIMIT || candidates.length > items.length
    },
    fallback: false, fallbackReason: null, rankingVersion: 'supabase-relational-v1',
    experiment: { experiment: 'supabase-relational-v1', variant: 'control', bucket: 0, holdout: false },
    rejections: [], personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      catalogue: 'supabase-primary', staticRelease: null, staticFetched: 0, staticServed: 0,
      relationalServed: items.length, staticMediaResolvable: 0, staticMaterialized: 0,
      staticTilesLoaded: 0, staticTilesRequested: 0,
      googleUiKitEligible: items.filter((item) => !item.photo_url && Boolean(item.google_place_id || item.google_client_lookup)).length,
      overlayRpc: 'r2_discovery_overlay_v1', candidateCache: { status: 'not-applicable' },
      timings: { catalogueMs: 0, overlayMs: Math.round(overlayMs * 100) / 100, totalMs: Math.round(totalMs * 100) / 100 }
    }
  }
}

export const getRelationalDiscoveryFallback = getRelationalDiscoveryFeed
