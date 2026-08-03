import { createHash, randomUUID } from 'node:crypto'
import { getDiscoveryFeed, isOpenAt, parseDiscoveryFilters } from './discovery.js'
import { categoryPlaceholderUrl, fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'
import { signStaticCatalogueReference } from './static-catalogue-ref.js'

function text(value) {
  return String(value || '').trim().toLowerCase()
}

function publicMediaUrl(supabase, path) {
  if (!path) return null
  if (/^https?:\/\//i.test(String(path))) return String(path)
  if (String(path).startsWith('/')) return String(path)
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function placeMatches(place, filters, now = new Date()) {
  const haystack = text(`${place.name || place.title} ${place.summary || ''} ${place.kind || place.category || ''} ${(place.amenities || []).join(' ')}`)
  if (filters.q && !haystack.includes(filters.q)) return false
  if (filters.category && (place.kind || place.category) !== filters.category) return false
  if (/^[1-4]$/.test(filters.price) && Number(place.priceLevel || place.price_level || 0) !== Number(filters.price)) return false
  if (filters.amenity && !(place.amenities || []).some((item) => text(item).includes(filters.amenity))) return false
  if (filters.accessible && !place.accessibility?.wheelchair_accessible && !place.accessibility?.step_free) return false
  if (filters.openNow && (!place.timezone || !isOpenAt(place.openingHours || place.opening_hours, place.timezone, now))) return false
  return true
}

function staticDescription(place) {
  if (String(place.summary || '').trim()) return String(place.summary).trim().slice(0, 500)
  const kind = String(place.kind || 'place').replaceAll('_', ' ')
  const locality = [place.city, place.region, place.country].find((value) => String(value || '').trim())
  return `A ${kind}${locality ? ` in ${locality}` : ''}. Details have not yet been verified.`
}

function safeStaticRef(place, manifest) {
  try {
    return signStaticCatalogueReference({ ...place, id: place.contentId }, manifest)
  } catch {
    return null
  }
}

function distanceLabel(distance) {
  if (!Number.isFinite(Number(distance))) return 'Distance unavailable'
  return Number(distance) < 1000 ? `${Math.round(distance)} m` : `${(Number(distance) / 1000).toFixed(1)} km`
}

function staticCard(place, manifest) {
  const contentId = place.contentId
  const distance = Number(place.distanceM)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const priceLevel = Number.isInteger(Number(place.priceLevel)) ? Number(place.priceLevel) : null
  const media = place.media || {}
  const photoUrl = media.photoUrl || null
  const staticRef = safeStaticRef(place, manifest)
  const href = staticRef ? `/api/static-catalogue/open/${contentId}?ref=${encodeURIComponent(staticRef)}` : null
  return {
    content_kind: 'place',
    content_id: contentId,
    slug: null,
    title: place.name,
    summary: staticDescription(place),
    description_source: place.summary ? 'location_summary' : 'generated_factual',
    category: place.kind,
    neighborhood: null,
    city: place.city,
    region: place.region,
    region_code: null,
    country: place.country,
    country_code: place.countryCode,
    postal_code: null,
    address_public: null,
    brand_id: null,
    brand_name: null,
    source_parent_place_id: null,
    duplicate_group_key: place.duplicateGroupKey,
    catalogue_group_key: place.catalogueGroupKey,
    source: 'import',
    starts_at: null,
    ends_at: null,
    timezone: place.timezone || 'UTC',
    timezone_verified: Boolean(place.timezone),
    price_cents: null,
    price_level: priceLevel,
    min_age: null,
    capacity: null,
    remaining_capacity: null,
    accessibility: place.accessibility || {},
    amenities: place.amenities || [],
    opening_hours: place.openingHours || {},
    latitude: place.latitude,
    longitude: place.longitude,
    distance_m: Number.isFinite(distance) ? distance : null,
    open_now: Boolean(place.timezone) && isOpenAt(place.openingHours, place.timezone),
    host_id: null,
    host_name: null,
    host_verified: false,
    published_at: null,
    popularity_score: 0,
    friend_score: 0,
    vector_similarity: null,
    embedding_model_version: null,
    score: relevance,
    relevance_score: relevance,
    scoreComponents: { cardTier: photoUrl ? 3 : media.googlePlaceId ? 2 : 1, contentQuality: photoUrl ? 0.75 : 0.35, ratingConfidence: 0, relevance },
    reasons: ['Nearby from the global catalogue'],
    candidateSources: ['r2_static'],
    loggedVectorSimilarity: null,
    cover_url: null,
    photo_url: photoUrl,
    has_real_photo: Boolean(photoUrl),
    photo_source: photoUrl ? 'licensed_public' : null,
    photo_provider: media.provider || null,
    photo_attribution: media.attribution || null,
    photo_attribution_url: media.attributionUrl || null,
    photo_license: media.license || null,
    photo_enrichment_status: photoUrl ? 'matched' : media.googlePlaceId ? 'pending' : 'no_match',
    google_place_id: media.googlePlaceId || null,
    google_place_match_score: media.googleMatchScore || null,
    card_tier: photoUrl ? 3 : media.googlePlaceId ? 2 : 1,
    card_readiness: photoUrl ? 'photo' : media.googlePlaceId ? 'google' : 'fallback',
    content_quality_score: photoUrl ? 0.75 : 0.35,
    recommendation_ready: true,
    rating_score: 0,
    average_rating: null,
    confidence_adjusted_rating: 3.8,
    rating_count: 0,
    rating_label: null,
    href,
    kindLabel: 'PLACE',
    distanceLabel: distanceLabel(distance),
    priceLabel: priceLevel ? '$'.repeat(priceLevel) : 'Price varies',
    static_catalogue_ephemeral: true,
    static_catalogue_source: place.source,
    static_catalogue_source_place_id: place.sourcePlaceId,
    static_ref: staticRef
  }
}

function relationalCard(session, row) {
  const photoUrl = row.photo_url || publicMediaUrl(session.supabase, row.cover_path)
  const googlePlaceId = row.google_place_id || null
  const distance = Number(row.distance_m)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const tier = photoUrl ? 3 : googlePlaceId ? 2 : 1
  return {
    content_kind: 'place',
    content_id: row.id,
    slug: row.slug,
    title: row.name,
    summary: row.summary || staticDescription({ name: row.name, kind: row.kind, city: row.city, region: row.region, country: row.country }),
    description_source: row.summary ? 'location_summary' : 'generated_factual',
    category: row.kind,
    neighborhood: row.neighborhood,
    city: row.city,
    region: row.region,
    region_code: row.region_code,
    country: row.country,
    country_code: row.country_code,
    postal_code: row.postal_code,
    address_public: row.address_public,
    brand_id: row.brand_id,
    brand_name: row.brand_name,
    source_parent_place_id: row.source_parent_place_id,
    duplicate_group_key: row.duplicate_group_key,
    catalogue_group_key: row.catalogue_group_key,
    source: row.source,
    starts_at: null,
    ends_at: null,
    timezone: row.timezone || 'UTC',
    timezone_verified: Boolean(row.timezone_verified),
    price_cents: null,
    price_level: row.price_level,
    min_age: null,
    capacity: null,
    remaining_capacity: null,
    accessibility: row.accessibility || {},
    amenities: row.amenities || [],
    opening_hours: row.opening_hours || {},
    latitude: row.latitude,
    longitude: row.longitude,
    distance_m: Number.isFinite(distance) ? distance : null,
    open_now: Boolean(row.timezone) && isOpenAt(row.opening_hours, row.timezone),
    host_id: null,
    host_name: null,
    host_verified: false,
    published_at: row.published_at || row.updated_at || null,
    popularity_score: 0,
    friend_score: 0,
    vector_similarity: null,
    embedding_model_version: null,
    score: relevance,
    relevance_score: relevance,
    scoreComponents: { cardTier: tier, contentQuality: photoUrl ? 0.8 : 0.4, ratingConfidence: 0, relevance },
    reasons: ['Nearby Puddle location'],
    candidateSources: ['relational_overlay'],
    loggedVectorSimilarity: null,
    cover_url: photoUrl,
    photo_url: photoUrl,
    has_real_photo: Boolean(photoUrl),
    photo_source: row.cover_path ? 'puddle_media' : photoUrl ? 'licensed_public' : null,
    photo_provider: row.cover_path ? 'puddle' : row.photo_provider || null,
    photo_attribution: row.photo_attribution || null,
    photo_attribution_url: row.photo_attribution_url || null,
    photo_license: row.photo_license || null,
    google_place_id: googlePlaceId,
    google_place_match_score: row.google_place_match_score || null,
    card_tier: tier,
    card_readiness: photoUrl ? 'photo' : googlePlaceId ? 'google' : 'fallback',
    content_quality_score: photoUrl ? 0.8 : 0.4,
    recommendation_ready: true,
    rating_score: 0,
    average_rating: null,
    confidence_adjusted_rating: 3.8,
    rating_count: 0,
    rating_label: null,
    href: row.slug ? `/places/${row.slug}` : null,
    kindLabel: 'PLACE',
    distanceLabel: distanceLabel(distance),
    priceLabel: row.price_level ? '$'.repeat(row.price_level) : 'Price varies',
    static_catalogue_ephemeral: false,
    static_ref: null
  }
}

function duplicateKey(item) {
  if (item.duplicate_group_key) return `duplicate:${item.duplicate_group_key}`
  if (item.catalogue_group_key) return `catalogue:${item.catalogue_group_key}`
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  return `fallback:${text(item.title)}:${Number.isFinite(latitude) ? latitude.toFixed(4) : ''}:${Number.isFinite(longitude) ? longitude.toFixed(4) : ''}`
}

function rankCards(items, interests, limit) {
  const preferred = new Set((interests || []).map(String))
  const indexed = items.map((item, index) => ({
    ...item,
    category_preference: preferred.has(item.category) ? 1 : 0,
    photo_priority: item.photo_url || item.cover_url || item.has_real_photo ? 2 : item.google_place_id ? 1 : 0,
    __original_index: index
  }))
  indexed.sort((a, b) =>
    Number(b.photo_priority) - Number(a.photo_priority)
    || Number(b.category_preference) - Number(a.category_preference)
    || Number(b.card_tier || 0) - Number(a.card_tier || 0)
    || Number(b.score || 0) - Number(a.score || 0)
    || Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity)
    || a.__original_index - b.__original_index
  )
  const seenIds = new Set()
  const seenDuplicates = new Set()
  const result = []
  for (const item of indexed) {
    if (seenIds.has(item.content_id)) continue
    const key = duplicateKey(item)
    if (seenDuplicates.has(key)) continue
    seenIds.add(item.content_id)
    seenDuplicates.add(key)
    const { __original_index, category_preference, photo_priority, ...clean } = item
    result.push(clean)
    if (result.length >= limit) break
  }
  return result
}

async function loadStaticCatalogueNear(session, rawFilters = {}) {
  const baseUrl = staticCatalogueBaseUrl()
  if (!baseUrl) return { enabled: false, places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0 }
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { enabled: true, places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0, filters, latitude: null, longitude: null }
  }
  const limit = Math.max(24, Math.min(300, Number(process.env.STATIC_CATALOGUE_DISCOVERY_LIMIT || Math.max(filters.limit * 8, 96))))
  const nearby = await fetchNearbyStaticPlaces({ latitude, longitude, radiusKm: filters.distance, limit, includeDetails: false, baseUrl })
  return {
    enabled: true,
    places: nearby.places.filter((place) => placeMatches(place, filters)),
    fetched: nearby.places.length,
    manifest: nearby.manifest,
    tilesLoaded: nearby.tilesLoaded,
    tilesRequested: nearby.tilesRequested,
    filters,
    latitude,
    longitude
  }
}

async function relationalOverlay(session, staticState) {
  const ids = staticState.places.map((place) => place.contentId).slice(0, 300)
  const result = await session.supabase.rpc('r2_discovery_overlay_v1', {
    static_ids: ids,
    center_lat: staticState.latitude,
    center_lng: staticState.longitude,
    radius_m: Math.round(staticState.filters.distance * 1000),
    max_rows: Math.min(120, Math.max(24, staticState.filters.limit * 4))
  })
  if (result.error) throw result.error
  return result.data || { dismissedIds: [], interests: session.profile?.interests || [], locations: [] }
}

function r2Feed(session, staticState, overlay) {
  const filters = staticState.filters
  const dismissed = new Set((overlay.dismissedIds || []).map(String))
  const relational = (overlay.locations || []).filter((row) => placeMatches(row, filters)).map((row) => relationalCard(session, row))
  const relationalIds = new Set(relational.map((item) => item.content_id))
  const staticItems = staticState.places
    .filter((place) => !dismissed.has(place.contentId) && !relationalIds.has(place.contentId))
    .map((place) => staticCard(place, staticState.manifest))
    .filter((item) => item.static_ref)
  const interests = [...new Set([...(session.profile?.interests || []), ...(overlay.interests || [])])]
  const items = rankCards([...relational, ...staticItems], interests, filters.limit)
  const categories = [...new Set([...items.map((item) => item.category), ...staticState.places.map((place) => place.kind)].filter(Boolean))].sort()
  const requestId = randomUUID()
  return {
    requestId,
    impressionKey: createHash('sha256').update(`${Math.floor(Date.now() / 300000)}:${JSON.stringify(filters)}`).digest('hex').slice(0, 32),
    items,
    filters,
    center: { latitude: staticState.latitude, longitude: staticState.longitude },
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories,
    recycled: false,
    emptyReason: !Number.isFinite(staticState.latitude) ? 'location_required' : items.length ? null : staticState.fetched ? 'filters' : 'catalogue_sync_pending',
    fallback: false,
    fallbackReason: null,
    rankingVersion: 'r2-overlay-v2',
    experiment: { experiment: 'r2-overlay-v2', variant: 'control', bucket: 0, holdout: false },
    rejections: [],
    personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      catalogue: 'r2-primary',
      staticRelease: staticState.manifest?.release || null,
      staticFetched: Number(staticState.fetched || 0),
      staticServed: items.filter((item) => item.static_catalogue_ephemeral).length,
      relationalServed: items.filter((item) => !item.static_catalogue_ephemeral).length,
      staticMaterialized: 0,
      staticTilesLoaded: Number(staticState.tilesLoaded || 0),
      staticTilesRequested: Number(staticState.tilesRequested || 0),
      googleUiKitEligible: items.filter((item) => !item.photo_url && Boolean(item.google_place_id)).length,
      overlayRpc: 'r2_discovery_overlay_v1'
    }
  }
}

function fallbackFeed(feed, reason) {
  return {
    ...feed,
    infrastructure: {
      catalogue: 'supabase-fallback',
      staticRelease: null,
      staticFetched: 0,
      staticServed: 0,
      relationalServed: (feed.items || []).length,
      staticMaterialized: 0,
      staticTilesLoaded: 0,
      staticTilesRequested: 0,
      googleUiKitEligible: 0,
      overlayRpc: null,
      fallbackReason: reason || null
    }
  }
}

export async function getInfrastructureDiscoveryFeed(session, rawFilters = {}) {
  if (!staticCatalogueBaseUrl()) return fallbackFeed(await getDiscoveryFeed(session, rawFilters), 'r2_not_configured')
  try {
    const staticState = await loadStaticCatalogueNear(session, rawFilters)
    if (staticState.latitude === null || staticState.longitude === null) {
      return r2Feed(session, staticState, { dismissedIds: [], interests: session.profile?.interests || [], locations: [] })
    }
    const overlay = await relationalOverlay(session, staticState)
    return r2Feed(session, staticState, overlay)
  } catch (error) {
    console.warn(`R2-first discovery failed; using relational fallback: ${error.message}`)
    return fallbackFeed(await getDiscoveryFeed(session, rawFilters), error.message)
  }
}

function sampled(requestId, rate = Number(process.env.DISCOVERY_ANALYTICS_SAMPLE_RATE || 0.1)) {
  const threshold = Math.max(0, Math.min(1, Number(rate) || 0)) * 256
  const byte = Number.parseInt(String(requestId || '').replaceAll('-', '').slice(-2), 16)
  return Number.isFinite(byte) && byte < threshold
}

export async function recordSampledInfrastructureAnalytics(session, feed) {
  if (!feed?.items?.length || !sampled(feed.requestId)) return false
  const scores = feed.items.map((item) => Number(item.score || 0)).filter(Number.isFinite)
  const result = await session.supabase.rpc('record_discovery_session_sample_v1', {
    sample: {
      requestId: feed.requestId,
      staticRelease: feed.infrastructure?.staticRelease || null,
      rankingVersion: feed.rankingVersion,
      centerLat: feed.center?.latitude ?? null,
      centerLng: feed.center?.longitude ?? null,
      filters: feed.filters || {},
      candidateIds: feed.items.slice(0, 40).map((item) => item.content_id),
      rankPositions: feed.items.slice(0, 40).map((_, index) => index + 1),
      scoreSummary: {
        min: scores.length ? Math.min(...scores) : null,
        max: scores.length ? Math.max(...scores) : null,
        mean: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
      },
      staticCount: feed.items.filter((item) => item.static_catalogue_ephemeral).length,
      relationalCount: feed.items.filter((item) => !item.static_catalogue_ephemeral).length
    }
  })
  if (result.error) throw result.error
  return true
}

// Backward-compatible export for callers that have not moved to sampled analytics yet.
export const logInfrastructureDiscoveryImpressions = recordSampledInfrastructureAnalytics
