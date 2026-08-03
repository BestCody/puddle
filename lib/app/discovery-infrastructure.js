import { createHash, randomUUID } from 'node:crypto'
import { isOpenAt, parseDiscoveryFilters } from './discovery-filters.js'
import { categoryPlaceholderUrl, fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'
import { signStaticCatalogueReference } from './static-catalogue-ref.js'

function text(value) {
  return String(value || '').trim().toLowerCase()
}

function publicMediaUrl(supabase, value) {
  if (!value) return null
  if (/^https?:\/\//i.test(String(value)) || String(value).startsWith('/')) return String(value)
  return supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function description(place) {
  if (String(place.summary || '').trim()) return String(place.summary).trim().slice(0, 500)
  const kind = String(place.kind || 'place').replaceAll('_', ' ')
  const locality = [place.city, place.region, place.country].find((value) => String(value || '').trim())
  return `A ${kind}${locality ? ` in ${locality}` : ''}. Details have not yet been verified.`
}

function distanceLabel(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance)) return 'Distance unavailable'
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`
}

function matches(place, filters, now = new Date()) {
  const hours = place.openingHours || place.opening_hours || {}
  const accessibility = place.accessibility || {}
  const amenities = place.amenities || []
  const haystack = text(`${place.name || place.title} ${place.summary || ''} ${place.kind || place.category || ''} ${amenities.join(' ')}`)
  if (filters.q && !haystack.includes(filters.q)) return false
  if (filters.category && (place.kind || place.category) !== filters.category) return false
  if (/^[1-4]$/.test(filters.price) && Number(place.priceLevel || place.price_level || 0) !== Number(filters.price)) return false
  if (filters.amenity && !amenities.some((item) => text(item).includes(filters.amenity))) return false
  if (filters.accessible && !accessibility.wheelchair_accessible && !accessibility.step_free) return false
  if (filters.openNow && (!place.timezone || !isOpenAt(hours, place.timezone, now))) return false
  return true
}

function safeReference(place, manifest) {
  try {
    return signStaticCatalogueReference({ ...place, id: place.contentId }, manifest)
  } catch {
    return null
  }
}

function baseCard({
  id, slug = null, name, summary, kind, city = null, region = null, country = null,
  countryCode = null, priceLevel = null, timezone = 'UTC', accessibility = {}, amenities = [],
  openingHours = {}, latitude, longitude, distance, photoUrl = null, googlePlaceId = null,
  photoProvider = null, photoAttribution = null, photoAttributionUrl = null, photoLicense = null,
  source = 'import', duplicateGroupKey = null, catalogueGroupKey = null, href = null,
  ephemeral = false, staticRef = null, staticSource = null, staticSourcePlaceId = null,
  coverPath = null, neighborhood = null, regionCode = null, postalCode = null,
  addressPublic = null, brandId = null, brandName = null, sourceParentPlaceId = null,
  publishedAt = null
}) {
  const numericDistance = Number(distance)
  const relevance = Number.isFinite(numericDistance) ? Math.max(0, 1 - numericDistance / 100_000) : 0
  const tier = photoUrl ? 3 : googlePlaceId ? 2 : 1
  return {
    content_kind: 'place', content_id: id, slug, title: name,
    summary: summary || description({ kind, city, region, country }),
    description_source: summary ? 'location_summary' : 'generated_factual',
    category: kind, neighborhood, city, region, region_code: regionCode,
    country, country_code: countryCode, postal_code: postalCode, address_public: addressPublic,
    brand_id: brandId, brand_name: brandName, source_parent_place_id: sourceParentPlaceId,
    duplicate_group_key: duplicateGroupKey, catalogue_group_key: catalogueGroupKey, source,
    starts_at: null, ends_at: null, timezone, timezone_verified: timezone !== 'UTC',
    price_cents: null, price_level: Number.isInteger(Number(priceLevel)) ? Number(priceLevel) : null,
    min_age: null, capacity: null, remaining_capacity: null,
    accessibility, amenities, opening_hours: openingHours,
    latitude, longitude, distance_m: Number.isFinite(numericDistance) ? numericDistance : null,
    open_now: Boolean(timezone) && isOpenAt(openingHours, timezone),
    host_id: null, host_name: null, host_verified: false, published_at: publishedAt,
    popularity_score: 0, friend_score: 0, vector_similarity: null, embedding_model_version: null,
    score: relevance, relevance_score: relevance,
    scoreComponents: { cardTier: tier, contentQuality: photoUrl ? 0.8 : 0.4, ratingConfidence: 0, relevance },
    reasons: [ephemeral ? 'Nearby from the global catalogue' : 'Nearby Puddle location'],
    candidateSources: [ephemeral ? 'r2_static' : 'relational_overlay'], loggedVectorSimilarity: null,
    cover_url: photoUrl, photo_url: photoUrl, has_real_photo: Boolean(photoUrl),
    photo_source: coverPath ? 'puddle_media' : photoUrl ? 'licensed_public' : null,
    photo_provider: coverPath ? 'puddle' : photoProvider,
    photo_attribution: photoAttribution, photo_attribution_url: photoAttributionUrl,
    photo_license: photoLicense,
    photo_enrichment_status: photoUrl ? 'matched' : googlePlaceId ? 'pending' : 'no_match',
    google_place_id: googlePlaceId, google_place_match_score: null,
    card_tier: tier, card_readiness: photoUrl ? 'photo' : googlePlaceId ? 'google' : 'fallback',
    content_quality_score: photoUrl ? 0.8 : 0.4, recommendation_ready: true,
    rating_score: 0, average_rating: null, confidence_adjusted_rating: 3.8,
    rating_count: 0, rating_label: null, href, kindLabel: 'PLACE',
    distanceLabel: distanceLabel(numericDistance),
    priceLabel: Number.isInteger(Number(priceLevel)) ? '$'.repeat(Number(priceLevel)) : 'Price varies',
    static_catalogue_ephemeral: ephemeral,
    static_catalogue_source: staticSource,
    static_catalogue_source_place_id: staticSourcePlaceId,
    static_ref: staticRef,
    category_placeholder_url: categoryPlaceholderUrl(kind)
  }
}

function staticCard(place, manifest) {
  const staticRef = safeReference(place, manifest)
  if (!staticRef) return null
  const media = place.media || {}
  return baseCard({
    id: place.contentId, name: place.name, summary: description(place), kind: place.kind,
    city: place.city, region: place.region, country: place.country, countryCode: place.countryCode,
    priceLevel: place.priceLevel, timezone: place.timezone || 'UTC',
    accessibility: place.accessibility || {}, amenities: place.amenities || [],
    openingHours: place.openingHours || {}, latitude: place.latitude, longitude: place.longitude,
    distance: place.distanceM, photoUrl: media.photoUrl || null,
    googlePlaceId: media.googlePlaceId || null, photoProvider: media.provider || null,
    photoAttribution: media.attribution || null, photoAttributionUrl: media.attributionUrl || null,
    photoLicense: media.license || null, duplicateGroupKey: place.duplicateGroupKey,
    catalogueGroupKey: place.catalogueGroupKey,
    href: `/api/static-catalogue/open/${place.contentId}?ref=${encodeURIComponent(staticRef)}`,
    ephemeral: true, staticRef, staticSource: place.source,
    staticSourcePlaceId: place.sourcePlaceId
  })
}

function relationalCard(session, row) {
  const photoUrl = row.photo_url || publicMediaUrl(session.supabase, row.cover_path)
  return baseCard({
    id: row.id, slug: row.slug, name: row.name, summary: row.summary, kind: row.kind,
    city: row.city, region: row.region, country: row.country, countryCode: row.country_code,
    priceLevel: row.price_level, timezone: row.timezone || 'UTC',
    accessibility: row.accessibility || {}, amenities: row.amenities || [],
    openingHours: row.opening_hours || {}, latitude: row.latitude, longitude: row.longitude,
    distance: row.distance_m, photoUrl, googlePlaceId: row.google_place_id || null,
    photoProvider: row.photo_provider || null, photoAttribution: row.photo_attribution || null,
    photoAttributionUrl: row.photo_attribution_url || null, photoLicense: row.photo_license || null,
    source: row.source, duplicateGroupKey: row.duplicate_group_key,
    catalogueGroupKey: row.catalogue_group_key, href: row.slug ? `/places/${row.slug}` : null,
    coverPath: row.cover_path, neighborhood: row.neighborhood, regionCode: row.region_code,
    postalCode: row.postal_code, addressPublic: row.address_public,
    brandId: row.brand_id, brandName: row.brand_name,
    sourceParentPlaceId: row.source_parent_place_id,
    publishedAt: row.published_at || row.updated_at || null
  })
}

function duplicateKey(item) {
  if (item.duplicate_group_key) return `duplicate:${item.duplicate_group_key}`
  if (item.catalogue_group_key) return `catalogue:${item.catalogue_group_key}`
  return `fallback:${text(item.title)}:${Number(item.latitude).toFixed(4)}:${Number(item.longitude).toFixed(4)}`
}

function rankCards(items, interests, limit) {
  const preferred = new Set((interests || []).map(String))
  const ranked = items.map((item, index) => ({
    ...item,
    __index: index,
    __photo: item.photo_url || item.cover_url || item.has_real_photo ? 2 : item.google_place_id ? 1 : 0,
    __preference: preferred.has(item.category) ? 1 : 0
  })).sort((a, b) =>
    b.__photo - a.__photo || b.__preference - a.__preference ||
    Number(b.card_tier || 0) - Number(a.card_tier || 0) ||
    Number(b.score || 0) - Number(a.score || 0) ||
    Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity) || a.__index - b.__index
  )
  const ids = new Set()
  const duplicates = new Set()
  const result = []
  for (const item of ranked) {
    const key = duplicateKey(item)
    if (ids.has(item.content_id) || duplicates.has(key)) continue
    ids.add(item.content_id)
    duplicates.add(key)
    const { __index, __photo, __preference, ...clean } = item
    result.push(clean)
    if (result.length >= limit) break
  }
  return result
}

async function loadStaticCatalogueNear(session, rawFilters = {}) {
  const baseUrl = staticCatalogueBaseUrl()
  if (!baseUrl) {
    const error = new Error('The schema-v3 R2 catalogue is not configured.')
    error.code = 'R2_CATALOGUE_NOT_CONFIGURED'
    error.status = 503
    throw error
  }
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { places: [], fetched: 0, manifest: null, tilesLoaded: 0, tilesRequested: 0, filters, latitude: null, longitude: null }
  }
  const limit = Math.max(24, Math.min(300, Number(process.env.STATIC_CATALOGUE_DISCOVERY_LIMIT || Math.max(filters.limit * 8, 96))))
  const nearby = await fetchNearbyStaticPlaces({
    latitude, longitude, radiusKm: filters.distance, limit,
    includeDetails: false, baseUrl
  })
  return {
    places: nearby.places.filter((place) => matches(place, filters)),
    fetched: nearby.places.length, manifest: nearby.manifest,
    tilesLoaded: nearby.tilesLoaded, tilesRequested: nearby.tilesRequested,
    filters, latitude, longitude
  }
}

async function relationalOverlay(session, state) {
  const result = await session.supabase.rpc('r2_discovery_overlay_v1', {
    static_ids: state.places.map((place) => place.contentId).slice(0, 300),
    center_lat: state.latitude, center_lng: state.longitude,
    radius_m: Math.round(state.filters.distance * 1000),
    max_rows: Math.min(120, Math.max(24, state.filters.limit * 4))
  })
  if (result.error) throw result.error
  return result.data || { dismissedIds: [], interests: session.profile?.interests || [], locations: [] }
}

function buildFeed(session, state, overlay) {
  const dismissed = new Set((overlay.dismissedIds || []).map(String))
  const relational = (overlay.locations || [])
    .filter((row) => matches(row, state.filters))
    .map((row) => relationalCard(session, row))
  const relationalIds = new Set(relational.map((item) => item.content_id))
  const staticItems = state.places
    .filter((place) => !dismissed.has(place.contentId) && !relationalIds.has(place.contentId))
    .map((place) => staticCard(place, state.manifest))
    .filter(Boolean)
  const interests = [...new Set([...(session.profile?.interests || []), ...(overlay.interests || [])])]
  const items = rankCards([...relational, ...staticItems], interests, state.filters.limit)
  const requestId = randomUUID()
  return {
    requestId,
    impressionKey: createHash('sha256').update(`${Math.floor(Date.now() / 300000)}:${JSON.stringify(state.filters)}`).digest('hex').slice(0, 32),
    items, filters: state.filters,
    center: state.latitude === null ? null : { latitude: state.latitude, longitude: state.longitude },
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [...new Set([...items.map((item) => item.category), ...state.places.map((place) => place.kind)].filter(Boolean))].sort(),
    recycled: false,
    emptyReason: state.latitude === null ? 'location_required' : items.length ? null : state.fetched ? 'filters' : 'catalogue_sync_pending',
    fallback: false, fallbackReason: null,
    rankingVersion: 'r2-overlay-v3',
    experiment: { experiment: 'r2-overlay-v3', variant: 'control', bucket: 0, holdout: false },
    rejections: [],
    personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      catalogue: 'r2-primary', staticRelease: state.manifest?.release || null,
      staticFetched: Number(state.fetched || 0),
      staticServed: items.filter((item) => item.static_catalogue_ephemeral).length,
      relationalServed: items.filter((item) => !item.static_catalogue_ephemeral).length,
      staticMaterialized: 0, staticTilesLoaded: Number(state.tilesLoaded || 0),
      staticTilesRequested: Number(state.tilesRequested || 0),
      googleUiKitEligible: items.filter((item) => !item.photo_url && Boolean(item.google_place_id)).length,
      overlayRpc: 'r2_discovery_overlay_v1'
    }
  }
}

export async function getInfrastructureDiscoveryFeed(session, rawFilters = {}) {
  const state = await loadStaticCatalogueNear(session, rawFilters)
  if (state.latitude === null || state.longitude === null) {
    return buildFeed(session, state, { dismissedIds: [], interests: session.profile?.interests || [], locations: [] })
  }
  return buildFeed(session, state, await relationalOverlay(session, state))
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
