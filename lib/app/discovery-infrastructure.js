import { createAdminClient } from '../supabase/admin.js'
import { getDiscoveryFeed, isOpenAt, logDiscoveryImpressions, parseDiscoveryFilters } from './discovery.js'
import { categoryPlaceholderUrl, fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'
import { staticCatalogueLocationId } from './static-catalogue-materialization.js'

function chunk(values, size = 100) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function locationIds(items = []) {
  return [...new Set(items
    .filter((item) => item?.content_kind === 'place' && item?.content_id && !item.static_catalogue_ephemeral)
    .map((item) => item.content_id))]
}

function text(value) {
  return String(value || '').trim().toLowerCase()
}

function staticPlaceMatches(place, filters, now = new Date()) {
  const haystack = text(`${place.name} ${place.summary || ''} ${place.kind || ''} ${(place.amenities || []).join(' ')}`)
  if (filters.q && !haystack.includes(filters.q)) return false
  if (filters.category && place.kind !== filters.category) return false
  if (/^[1-4]$/.test(filters.price) && Number(place.priceLevel || 0) !== Number(filters.price)) return false
  if (filters.amenity && !(place.amenities || []).some((item) => text(item).includes(filters.amenity))) return false
  if (filters.accessible && !place.accessibility?.wheelchair_accessible && !place.accessibility?.step_free) return false
  if (filters.openNow && (!place.timezone || !isOpenAt(place.openingHours, place.timezone, now))) return false
  return true
}

function staticDescription(place) {
  if (String(place.summary || '').trim()) return String(place.summary).trim().slice(0, 500)
  const kind = String(place.kind || 'place').replaceAll('_', ' ')
  const locality = [place.neighborhood, place.city, place.region].find((value) => String(value || '').trim())
  return `A ${kind}${locality ? ` in ${locality}` : ''}. Details have not yet been verified.`
}

function staticCard(place) {
  const contentId = staticCatalogueLocationId(place.source, place.sourcePlaceId)
  const distance = Number(place.distanceM)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const priceLevel = Number.isInteger(Number(place.priceLevel)) ? Number(place.priceLevel) : null
  return {
    content_kind: 'place',
    content_id: contentId,
    slug: place.slug,
    title: place.name,
    summary: staticDescription(place),
    description_source: place.summary ? 'location_summary' : 'generated_factual',
    category: place.kind,
    neighborhood: place.neighborhood,
    city: place.city,
    region: place.region,
    region_code: place.regionCode,
    country: place.country,
    country_code: place.countryCode,
    postal_code: place.postalCode,
    address_public: place.addressPublic,
    brand_id: place.brandId,
    brand_name: place.brandName,
    source_parent_place_id: place.sourceParentPlaceId,
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
    published_at: place.sourceUpdatedAt || null,
    popularity_score: 0,
    friend_score: 0,
    vector_similarity: null,
    embedding_model_version: null,
    score: relevance,
    relevance_score: relevance,
    scoreComponents: { cardTier: 1, contentQuality: 0.35, ratingConfidence: 0, relevance },
    reasons: ['Nearby from the global catalogue'],
    candidateSources: ['r2_static'],
    loggedVectorSimilarity: null,
    cover_url: null,
    photo_url: null,
    has_real_photo: false,
    photo_source: null,
    photo_provider: null,
    photo_attribution: null,
    photo_attribution_url: null,
    photo_license: null,
    photo_enrichment_status: 'no_match',
    card_tier: 1,
    card_readiness: 'fallback',
    content_quality_score: 0.35,
    recommendation_ready: true,
    rating_score: 0,
    average_rating: null,
    confidence_adjusted_rating: 3.8,
    rating_count: 0,
    rating_label: null,
    href: `/api/static-catalogue/open/${contentId}`,
    kindLabel: 'PLACE',
    distanceLabel: !Number.isFinite(distance) ? 'Distance unavailable' : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`,
    priceLabel: priceLevel ? '$'.repeat(priceLevel) : 'Price varies',
    static_catalogue_ephemeral: true,
    static_catalogue_source: place.source,
    static_catalogue_source_place_id: place.sourcePlaceId
  }
}

async function existingStaticSources(admin, places) {
  const existing = new Set()
  const grouped = new Map()
  for (const place of places) {
    if (!['overture', 'fsq_os'].includes(place.source)) continue
    if (!grouped.has(place.source)) grouped.set(place.source, [])
    grouped.get(place.source).push(place.sourcePlaceId)
  }
  for (const [source, sourceIds] of grouped) {
    for (const values of chunk(sourceIds, 100)) {
      const result = await admin
        .from('location_source_links')
        .select('source_place_id')
        .eq('source', source)
        .in('source_place_id', values)
      if (result.error) throw result.error
      for (const row of result.data || []) existing.add(`${source}:${row.source_place_id}`)
    }
  }
  return existing
}

async function loadStaticCatalogueNear(session, rawFilters = {}) {
  const baseUrl = staticCatalogueBaseUrl()
  if (!baseUrl) return { enabled: false, places: [], fetched: 0, release: null, tilesLoaded: 0, tilesRequested: 0 }
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { enabled: true, places: [], fetched: 0, release: null, tilesLoaded: 0, tilesRequested: 0 }
  }

  const limit = Math.max(24, Math.min(300, Number(process.env.STATIC_CATALOGUE_DISCOVERY_LIMIT || Math.max(filters.limit * 12, 144))))
  const nearby = await fetchNearbyStaticPlaces({ latitude, longitude, radiusKm: filters.distance, limit, baseUrl })
  const eligible = nearby.places.filter((place) => staticPlaceMatches(place, filters))
  const existing = eligible.length ? await existingStaticSources(createAdminClient(), eligible) : new Set()
  const places = eligible.filter((place) => !existing.has(`${place.source}:${place.sourcePlaceId}`))
  return {
    enabled: true,
    places,
    fetched: nearby.places.length,
    release: nearby.manifest?.release || null,
    tilesLoaded: nearby.tilesLoaded,
    tilesRequested: nearby.tilesRequested
  }
}

async function googlePlaceIds(session, items) {
  const ids = locationIds(items)
  if (!ids.length) return new Map()
  const rows = []
  for (const values of chunk(ids, 100)) {
    const result = await session.supabase
      .from('location_google_places')
      .select('location_id,google_place_id,match_score')
      .eq('status', 'verified')
      .in('location_id', values)
    if (result.error) return new Map()
    rows.push(...(result.data || []))
  }
  return new Map(rows.map((row) => [row.location_id, row]))
}

function duplicateKey(item) {
  if (item.duplicate_group_key) return `duplicate:${item.duplicate_group_key}`
  if (item.catalogue_group_key) return `catalogue:${item.catalogue_group_key}`
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  return `fallback:${text(item.title)}:${Number.isFinite(latitude) ? latitude.toFixed(4) : ''}:${Number.isFinite(longitude) ? longitude.toFixed(4) : ''}`
}

export async function enhanceDiscoveryFeedInfrastructure(session, feed, staticState = null) {
  const staticItems = (staticState?.places || []).map(staticCard)
  const mappings = await googlePlaceIds(session, feed.items || [])
  const indexed = [...(feed.items || []), ...staticItems].map((item, index) => {
    const mapping = item.content_kind === 'place' && !item.static_catalogue_ephemeral ? mappings.get(item.content_id) : null
    const hasCachedPhoto = Boolean(item.photo_url || item.cover_url || item.has_real_photo)
    return {
      ...item,
      google_place_id: mapping?.google_place_id || item.google_place_id || null,
      google_place_match_score: mapping ? Number(mapping.match_score) : item.google_place_match_score || null,
      category_placeholder_url: categoryPlaceholderUrl(item.category),
      photo_priority: hasCachedPhoto ? 2 : mapping?.google_place_id ? 1 : 0,
      __original_index: index
    }
  })
  indexed.sort((a, b) =>
    Number(b.photo_priority || 0) - Number(a.photo_priority || 0)
    || Number(b.card_tier || 0) - Number(a.card_tier || 0)
    || Number(b.score || 0) - Number(a.score || 0)
    || Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity)
    || a.__original_index - b.__original_index
  )

  const seen = new Set()
  const limit = Number(feed.filters?.limit || 40)
  const items = []
  for (const item of indexed) {
    const key = duplicateKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    const { __original_index, ...clean } = item
    items.push(clean)
    if (items.length >= limit) break
  }
  const categories = [...new Set([...(feed.categories || []), ...staticItems.map((item) => item.category)].filter(Boolean))].sort()
  return {
    ...feed,
    items,
    categories,
    emptyReason: items.length ? null : feed.emptyReason,
    infrastructure: {
      catalogue: staticState?.enabled ? 'r2-static-read-through' : 'supabase-fallback',
      staticRelease: staticState?.release || null,
      staticFetched: Number(staticState?.fetched || 0),
      staticServed: items.filter((item) => item.static_catalogue_ephemeral).length,
      staticMaterialized: 0,
      staticTilesLoaded: Number(staticState?.tilesLoaded || 0),
      staticTilesRequested: Number(staticState?.tilesRequested || 0),
      googleUiKitEligible: items.filter((item) => !item.photo_url && Boolean(item.google_place_id)).length
    }
  }
}

export async function getInfrastructureDiscoveryFeed(session, rawFilters = {}) {
  let staticState = { enabled: Boolean(staticCatalogueBaseUrl()), places: [], fetched: 0, release: null, tilesLoaded: 0, tilesRequested: 0 }
  const [feed, staticResult] = await Promise.all([
    getDiscoveryFeed(session, rawFilters),
    loadStaticCatalogueNear(session, rawFilters).catch((error) => ({ ...staticState, error: error.message }))
  ])
  staticState = staticResult
  if (staticState.error) console.warn(`Static catalogue read-through failed: ${staticState.error}`)
  return enhanceDiscoveryFeedInfrastructure(session, feed, staticState)
}

export async function logInfrastructureDiscoveryImpressions(session, feed) {
  const items = (feed.items || []).filter((item) => !item.static_catalogue_ephemeral)
  const staticIds = new Set((feed.items || []).filter((item) => item.static_catalogue_ephemeral).map((item) => item.content_id))
  const rejections = (feed.rejections || []).filter((item) => !staticIds.has(item.content_id))
  if (!items.length) return
  return logDiscoveryImpressions(session, { ...feed, items, rejections })
}
