import { getDiscoveryFeed, isOpenAt, logDiscoveryImpressions, parseDiscoveryFilters } from './discovery.js'
import { categoryPlaceholderUrl, fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'
import { signStaticCatalogueReference } from './static-catalogue-ref.js'

function chunk(values, size = 100) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function relationalLocationIds(items = []) {
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

function staticCard(place, manifest) {
  const contentId = place.contentId
  const distance = Number(place.distanceM)
  const relevance = Number.isFinite(distance) ? Math.max(0, 1 - distance / 100_000) : 0
  const priceLevel = Number.isInteger(Number(place.priceLevel)) ? Number(place.priceLevel) : null
  const media = place.media || {}
  const photoUrl = media.photoUrl || null
  const staticRef = safeStaticRef(place, manifest)
  const href = staticRef
    ? `/api/static-catalogue/open/${contentId}?ref=${encodeURIComponent(staticRef)}`
    : null
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
    distanceLabel: !Number.isFinite(distance) ? 'Distance unavailable' : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`,
    priceLabel: priceLevel ? '$'.repeat(priceLevel) : 'Price varies',
    static_catalogue_ephemeral: true,
    static_catalogue_source: place.source,
    static_catalogue_source_place_id: place.sourcePlaceId,
    static_ref: staticRef
  }
}

async function loadStaticCatalogueNear(session, rawFilters = {}) {
  const baseUrl = staticCatalogueBaseUrl()
  if (!baseUrl) return { enabled: false, places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0 }
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { enabled: true, places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0 }
  }
  const limit = Math.max(24, Math.min(300, Number(process.env.STATIC_CATALOGUE_DISCOVERY_LIMIT || Math.max(filters.limit * 12, 144))))
  const includeDetails = Boolean(filters.openNow || filters.accessible || filters.amenity)
  const nearby = await fetchNearbyStaticPlaces({ latitude, longitude, radiusKm: filters.distance, limit, includeDetails, baseUrl })
  return {
    enabled: true,
    places: nearby.places.filter((place) => staticPlaceMatches(place, filters)),
    fetched: nearby.places.length,
    manifest: nearby.manifest,
    tilesLoaded: nearby.tilesLoaded,
    tilesRequested: nearby.tilesRequested
  }
}

async function googlePlaceIds(session, items) {
  const ids = relationalLocationIds(items)
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

async function dismissedStaticIds(session, items) {
  const ids = [...new Set(items.map((item) => item.content_id).filter(Boolean))]
  if (!ids.length) return new Set()
  const rows = []
  for (const values of chunk(ids, 100)) {
    const result = await session.supabase
      .from('static_catalogue_actions')
      .select('location_id')
      .eq('action', 'dismissed')
      .gt('expires_at', new Date().toISOString())
      .in('location_id', values)
    if (result.error) return new Set()
    rows.push(...(result.data || []))
  }
  return new Set(rows.map((row) => row.location_id))
}

function duplicateKey(item) {
  if (item.duplicate_group_key) return `duplicate:${item.duplicate_group_key}`
  if (item.catalogue_group_key) return `catalogue:${item.catalogue_group_key}`
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  return `fallback:${text(item.title)}:${Number.isFinite(latitude) ? latitude.toFixed(4) : ''}:${Number.isFinite(longitude) ? longitude.toFixed(4) : ''}`
}

export async function enhanceDiscoveryFeedInfrastructure(session, feed, staticState = null) {
  const relationalItems = feed.items || []
  const relationalIds = new Set(relationalItems.map((item) => item.content_id).filter(Boolean))
  let staticItems = (staticState?.places || [])
    .map((place) => staticCard(place, staticState?.manifest))
    .filter((item) => item.static_ref && !relationalIds.has(item.content_id))
  const dismissed = await dismissedStaticIds(session, staticItems)
  staticItems = staticItems.filter((item) => !dismissed.has(item.content_id))
  const mappings = await googlePlaceIds(session, relationalItems)
  const indexed = [...relationalItems, ...staticItems].map((item, index) => {
    const mapping = item.content_kind === 'place' && !item.static_catalogue_ephemeral ? mappings.get(item.content_id) : null
    const hasCachedPhoto = Boolean(item.photo_url || item.cover_url || item.has_real_photo)
    const googlePlaceId = mapping?.google_place_id || item.google_place_id || null
    return {
      ...item,
      google_place_id: googlePlaceId,
      google_place_match_score: mapping ? Number(mapping.match_score) : item.google_place_match_score || null,
      category_placeholder_url: categoryPlaceholderUrl(item.category),
      photo_priority: hasCachedPhoto ? 2 : googlePlaceId ? 1 : 0,
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
      staticRelease: staticState?.manifest?.release || null,
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
  let staticState = { enabled: Boolean(staticCatalogueBaseUrl()), places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0 }
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
