import { createHash, randomUUID } from 'node:crypto'
import { suppressCatalogueRepetition } from './catalogue-quality'
import { diversifyRecommendations, HYBRID_RANKING_VERSION, RULES_FALLBACK_VERSION, scoreHybridCandidate } from './hybrid-recommendations'
import { chooseLocationPhoto, photoMetadata, providerPhotoPath } from './place-photos'
import {
  buildFactualLocationDescription,
  compareLocationCandidates,
  composeLocationRankingScore,
  evaluateLocationCardQuality,
  normalizeRatingSummary,
  ratingLabel
} from './location-quality'

export const DEFAULT_CENTER = null
const KIND_OPTIONS = new Set(['all', 'event', 'place'])
const DATE_OPTIONS = new Set(['any', 'tonight', 'weekend', 'next7'])
const PRICE_OPTIONS = new Set(['any', 'free', '1', '2', '3', '4'])

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function number(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

export function parseDiscoveryFilters(source = {}, defaultDistance = 25) {
  const kind = KIND_OPTIONS.has(source.kind) ? source.kind : 'all'
  const date = DATE_OPTIONS.has(source.date) ? source.date : 'any'
  const requestedDistance = number(source.distance, number(defaultDistance, 25))
  const distance = Math.max(1, Math.min(100, requestedDistance || 25))
  const price = PRICE_OPTIONS.has(String(source.price)) ? String(source.price) : 'any'
  return {
    q: text(source.q, 100).toLowerCase(),
    kind,
    category: text(source.category, 60),
    date,
    distance,
    price,
    openNow: boolean(source.open_now ?? source.openNow),
    accessible: boolean(source.accessible),
    available: boolean(source.available),
    amenity: text(source.amenity, 60).toLowerCase(),
    latitude: number(source.latitude, null),
    longitude: number(source.longitude, null),
    limit: Math.min(100, Math.max(1, number(source.limit, 40)))
  }
}

function dateWindow(filter, now = new Date()) {
  if (filter === 'any') return null
  if (filter === 'tonight') {
    const start = new Date(now)
    start.setHours(17, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    end.setHours(5, 0, 0, 0)
    return [start, end]
  }
  if (filter === 'next7') return [now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)]
  const start = new Date(now)
  const day = start.getDay()
  start.setDate(start.getDate() + ((5 - day + 7) % 7))
  start.setHours(16, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 3)
  end.setHours(5, 0, 0, 0)
  return [start, end]
}

function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3]?.toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function isOpenAt(openingHours, timezone, at = new Date()) {
  if (!openingHours || typeof openingHours !== 'object') return false
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false })
    const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
    const value = String(openingHours[String(parts.weekday || '').toLowerCase()] || '').trim()
    if (!value || /^closed$/i.test(value)) return false
    if (/24\s*hours|open\s*24/i.test(value)) return true
    const [rawStart, rawEnd] = value.replace(/[–—]/g, '-').split('-').map((part) => part.trim())
    const start = parseClock(rawStart)
    const end = parseClock(rawEnd)
    if (start === null || end === null) return true
    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
    return end >= start ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
  } catch {
    return false
  }
}

function ageFromBirthDate(value, now = new Date()) {
  if (!value) return null
  const birth = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return null
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1
  return age
}

function publicMediaUrl(supabase, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  if (![aLat, aLng, bLat, bLng].every((value) => Number.isFinite(Number(value)))) return null
  const radians = (value) => Number(value) * Math.PI / 180
  const dLat = radians(Number(bLat) - Number(aLat))
  const dLng = radians(Number(bLng) - Number(aLng))
  const first = radians(aLat)
  const second = radians(bLat)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(first) * Math.cos(second) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function candidateRejectionReasons(candidate, filters, profile, now = new Date()) {
  const reasons = []
  const haystack = `${candidate.title} ${candidate.summary || ''} ${candidate.category || ''} ${(candidate.amenities || []).join(' ')}`.toLowerCase()
  if (filters.q && !haystack.includes(filters.q)) reasons.push('search_mismatch')
  if (filters.kind !== 'all' && candidate.content_kind !== filters.kind) reasons.push('content_kind')
  if (filters.category && candidate.category !== filters.category) reasons.push('category')
  if (candidate.distance_m !== null && candidate.distance_m !== undefined && candidate.distance_m > filters.distance * 1000) reasons.push('distance')

  const window = dateWindow(filters.date, now)
  if (window && candidate.content_kind === 'event') {
    const starts = new Date(candidate.starts_at)
    if (starts < window[0] || starts > window[1]) reasons.push('date_window')
  }
  if (window && candidate.content_kind === 'place') reasons.push('date_filter_excludes_places')
  if (filters.openNow && (candidate.content_kind !== 'place' || !candidate.open_now)) reasons.push('not_open_now')
  if (filters.accessible && !candidate.accessibility?.wheelchair_accessible && !candidate.accessibility?.step_free) reasons.push('accessibility_filter')
  if (filters.available && candidate.content_kind === 'event' && candidate.remaining_capacity !== null && Number(candidate.remaining_capacity) <= 0) reasons.push('no_capacity')
  if (filters.amenity && !(candidate.amenities || []).some((item) => String(item).toLowerCase().includes(filters.amenity))) reasons.push('amenity_filter')
  if (filters.price === 'free' && candidate.content_kind === 'event' && Number(candidate.price_cents || 0) > 0) reasons.push('price_filter')
  if (/^[1-4]$/.test(filters.price) && candidate.content_kind === 'place' && Number(candidate.price_level || 0) !== Number(filters.price)) reasons.push('price_level')

  const age = ageFromBirthDate(profile?.birth_date, now)
  if (candidate.min_age && (age === null || age < Number(candidate.min_age))) reasons.push('age_eligibility')
  if (candidate.content_kind === 'event' && candidate.ends_at && new Date(candidate.ends_at) <= now) reasons.push('event_ended')
  return [...new Set(reasons)]
}

function defaultContext(profile = {}) {
  return {
    explicitInterests: profile.interests || [],
    positiveCategories: {},
    negativeCategories: {},
    friendCategories: {},
    followedHosts: [],
    recentTargets: [],
    preferences: { behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false },
    featureFlags: { vector: false, behavioral: true }
  }
}

function normalizeContext(value, profile) {
  const source = value && typeof value === 'object' ? value : {}
  return { ...defaultContext(profile), ...source, preferences: { ...defaultContext(profile).preferences, ...(source.preferences || {}) }, featureFlags: { ...defaultContext(profile).featureFlags, ...(source.featureFlags || {}) } }
}

async function recommendationContext(session) {
  const [contextResult, assignmentResult] = await Promise.all([
    session.supabase.rpc('recommendation_context_v1'),
    session.supabase.rpc('assign_recommendation_experiment_v1', { target_experiment: 'hybrid-ranking-v1' })
  ])
  return {
    context: normalizeContext(contextResult.error ? null : contextResult.data, session.profile),
    experiment: assignmentResult.error || !assignmentResult.data ? { experiment: 'hybrid-ranking-v1', variant: 'control', bucket: 0, holdout: false } : assignmentResult.data,
    migrationAvailable: !contextResult.error && !assignmentResult.error
  }
}

async function directCandidates(session, center) {
  if (!center) return []
  const blockResult = await session.supabase.from('blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${session.user.id},blocked_id.eq.${session.user.id}`)
  const blocked = new Set((blockResult.data || []).map((row) => row.blocker_id === session.user.id ? row.blocked_id : row.blocker_id))
  const [eventsResult, locationsResult] = await Promise.all([
    session.supabase.from('events').select('id,slug,title,summary,category,starts_at,ends_at,timezone,price_from_cents,min_age,capacity,accessibility,cover_path,published_at,host_profile_id,created_by,locations(latitude,longitude),host_profiles(name,verification_status)').eq('status', 'published').eq('visibility', 'public').gt('ends_at', new Date().toISOString()).limit(500),
    session.supabase.from('locations').select('id,slug,name,summary,kind,timezone,timezone_verified,price_level,accessibility,amenities,opening_hours,latitude,longitude,neighborhood,city,region,region_code,country,country_code,postal_code,address_public,brand_id,brand_name,parent_location_id,source_parent_place_id,duplicate_group_key,catalogue_group_key,cover_path,published_at,updated_at,host_profile_id,created_by,has_private_address,source,host_profiles(name,verification_status)').eq('status', 'published').eq('visibility', 'public').limit(1000)
  ])
  const events = (eventsResult.data || []).filter((item) => !blocked.has(item.created_by)).map((event) => ({
    content_kind: 'event', content_id: event.id, slug: event.slug, title: event.title, summary: event.summary, category: event.category,
    starts_at: event.starts_at, ends_at: event.ends_at, timezone: event.timezone, price_cents: event.price_from_cents, price_level: null,
    min_age: event.min_age, capacity: event.capacity, remaining_capacity: null, accessibility: event.accessibility || {}, amenities: [], opening_hours: {},
    latitude: event.locations?.latitude, longitude: event.locations?.longitude, distance_m: haversineMeters(center.latitude, center.longitude, event.locations?.latitude, event.locations?.longitude),
    cover_path: event.cover_path, host_id: event.host_profile_id, host_name: event.host_profiles?.name, host_verified: event.host_profiles?.verification_status === 'verified',
    published_at: event.published_at, popularity_score: 0, friend_score: 0, vector_similarity: null, embedding_model_version: null, candidate_sources: ['rules_fallback']
  }))
  const places = (locationsResult.data || []).filter((item) => !blocked.has(item.created_by) && !item.has_private_address).map((location) => ({
    content_kind: 'place', content_id: location.id, slug: location.slug, title: location.name, summary: location.summary, category: location.kind,
    neighborhood: location.neighborhood, city: location.city, region: location.region, region_code: location.region_code, country: location.country, country_code: location.country_code,
    postal_code: location.postal_code, address_public: location.address_public, brand_id: location.brand_id, brand_name: location.brand_name,
    parent_location_id: location.parent_location_id, source_parent_place_id: location.source_parent_place_id,
    duplicate_group_key: location.duplicate_group_key, catalogue_group_key: location.catalogue_group_key, source: location.source,
    starts_at: null, ends_at: null, timezone: location.timezone, timezone_verified: location.timezone_verified,
    price_cents: null, price_level: location.price_level, min_age: null, capacity: null, remaining_capacity: null,
    accessibility: location.accessibility || {}, amenities: location.amenities || [], opening_hours: location.opening_hours || {}, latitude: location.latitude, longitude: location.longitude,
    distance_m: haversineMeters(center.latitude, center.longitude, location.latitude, location.longitude), cover_path: location.cover_path, host_id: location.host_profile_id,
    host_name: location.host_profiles?.name, host_verified: location.host_profiles?.verification_status === 'verified', published_at: location.published_at || location.updated_at,
    popularity_score: 0, friend_score: 0, vector_similarity: null, embedding_model_version: null, candidate_sources: ['rules_fallback']
  })).sort((a, b) => Number(a.distance_m ?? Infinity) - Number(b.distance_m ?? Infinity)).slice(0, 500)
  return [...events, ...places]
}

async function queryCandidates(session, filters) {
  const latitude = number(filters.latitude ?? session.profile?.latitude, null)
  const longitude = number(filters.longitude ?? session.profile?.longitude, null)
  if (latitude === null || longitude === null) {
    return { candidates: [], center: null, fallbackReason: 'location_required', migrationAvailable: true }
  }
  const center = { latitude, longitude }
  const result = await session.supabase.rpc('recommendation_candidate_pool_v1', {
    user_lat: center.latitude,
    user_lng: center.longitude,
    radius_m: filters.distance * 1000,
    max_rows: 500
  })
  if (!result.error) return { candidates: result.data || [], center, fallbackReason: null, migrationAvailable: true }
  return { candidates: await directCandidates(session, center), center, fallbackReason: 'hybrid_candidate_pool_unavailable', migrationAvailable: false }
}

function locationIds(candidates) {
  return [...new Set(candidates.filter((candidate) => candidate.content_kind === 'place').map((candidate) => candidate.content_id).filter(Boolean))]
}

async function loadLocationCatalogueMetadata(session, candidates) {
  const ids = locationIds(candidates)
  if (!ids.length) return new Map()
  const rows = []
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await session.supabase
      .from('locations')
      .select('id,source,timezone_verified,region_code,postal_code,address_public,brand_id,brand_name,parent_location_id,source_parent_place_id,duplicate_group_key,catalogue_group_key,category_confidence')
      .in('id', ids.slice(index, index + 100))
    if (error) return new Map()
    rows.push(...(data || []))
  }
  return new Map(rows.map((row) => [row.id, row]))
}

async function loadLocationPhotos(session, candidates, now) {
  const ids = locationIds(candidates)
  if (!ids.length) return new Map()

  const rows = []
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await session.supabase
      .from('location_photo_sources')
      .select('id,location_id,source,provider,attribution_text,attribution_url,license_code,width,height,is_primary,sort_order,status,is_ai_generated,verified_at,expires_at')
      .in('location_id', ids.slice(index, index + 100))
      .eq('status', 'approved')
    if (error) return new Map()
    rows.push(...(data || []))
  }

  const grouped = new Map()
  for (const row of rows) {
    const current = grouped.get(row.location_id) || []
    current.push(row)
    grouped.set(row.location_id, current)
  }
  return new Map([...grouped].map(([locationId, photoRows]) => [locationId, chooseLocationPhoto(photoRows, now)]))
}

async function loadLocationQuality(session, candidates) {
  const ids = locationIds(candidates)
  if (!ids.length) return new Map()
  const rows = []
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await session.supabase
      .from('location_card_quality_v1')
      .select('location_id,description,description_source,has_real_photo,card_tier,average_rating,confidence_adjusted_rating,rating_count,happened_count,last_feedback_at')
      .in('location_id', ids.slice(index, index + 100))
    if (error) return new Map()
    rows.push(...(data || []))
  }
  return new Map(rows.map((row) => [row.location_id, row]))
}

function formatCandidate(session, candidate, ranking, locationPhotos, locationQuality) {
  const puddlePhotoUrl = publicMediaUrl(session.supabase, candidate.cover_path)
  const providerPhoto = candidate.content_kind === 'place' ? locationPhotos.get(candidate.content_id) : null
  const providerMetadata = photoMetadata(providerPhoto)
  const photoUrl = puddlePhotoUrl || providerPhotoPath(providerMetadata?.id)
  const qualityRow = candidate.content_kind === 'place' ? locationQuality.get(candidate.content_id) || {} : {}
  const description = qualityRow.description || candidate.summary || buildFactualLocationDescription(candidate)
  const quality = evaluateLocationCardQuality(candidate, {
    description,
    descriptionSource: qualityRow.description_source || (candidate.summary ? 'location_summary' : 'generated_factual'),
    hasRealPhoto: Boolean(photoUrl)
  })
  const rating = normalizeRatingSummary(qualityRow)
  const relevanceScore = ranking.finalScore
  const score = composeLocationRankingScore({ cardTier: quality.cardTier, ratingScore: rating.ratingScore, relevanceScore })
  const reasons = [...ranking.explanations]
  if (quality.cardTier >= 2) reasons.unshift('Complete photo and location details')
  if (rating.ratingCount > 0) reasons.push('Rated by people who used Puddle')

  return {
    ...candidate,
    summary: quality.description,
    description_source: quality.descriptionSource,
    score,
    relevance_score: relevanceScore,
    scoreComponents: {
      ...ranking.components,
      cardTier: quality.cardTier,
      contentQuality: quality.contentQualityScore,
      ratingConfidence: rating.ratingScore,
      relevance: relevanceScore
    },
    reasons: [...new Set(reasons)].slice(0, 4),
    candidateSources: ranking.candidateSources,
    loggedVectorSimilarity: ranking.vectorSimilarity,
    cover_url: photoUrl,
    photo_url: photoUrl,
    has_real_photo: quality.hasRealPhoto,
    photo_source: puddlePhotoUrl ? 'puddle_media' : providerMetadata?.source || null,
    photo_provider: puddlePhotoUrl ? 'puddle' : providerMetadata?.provider || null,
    photo_attribution: providerMetadata?.attribution || null,
    photo_attribution_url: providerMetadata?.attributionUrl || null,
    photo_license: providerMetadata?.license || null,
    card_tier: quality.cardTier,
    card_readiness: quality.cardTier >= 3 ? 'premium' : quality.cardTier === 2 ? 'standard' : 'fallback',
    content_quality_score: quality.contentQualityScore,
    recommendation_ready: quality.recommendationReady,
    rating_score: rating.ratingScore,
    average_rating: rating.averageRating,
    confidence_adjusted_rating: rating.confidenceAdjustedRating,
    rating_count: rating.ratingCount,
    rating_label: ratingLabel({ rating_count: rating.ratingCount, confidence_adjusted_rating: rating.confidenceAdjustedRating }),
    href: candidate.content_kind === 'event' ? `/events/${candidate.slug}` : `/places/${candidate.slug}`,
    kindLabel: candidate.content_kind === 'event' ? 'EVENT' : 'PLACE',
    distanceLabel: candidate.distance_m === null || candidate.distance_m === undefined ? 'Distance unavailable' : Number(candidate.distance_m) < 1000 ? `${Math.round(candidate.distance_m)} m` : `${(Number(candidate.distance_m) / 1000).toFixed(1)} km`,
    priceLabel: candidate.content_kind === 'event' ? (candidate.price_cents ? `$${Math.round(candidate.price_cents / 100)}` : 'Free') : (candidate.price_level ? '$'.repeat(candidate.price_level) : 'Price varies')
  }
}

function impressionKey(filters, now = new Date()) {
  const bucket = Math.floor(now.getTime() / 300000)
  return createHash('sha256').update(`${bucket}:${JSON.stringify(filters)}`).digest('hex').slice(0, 32)
}

export async function getDiscoveryFeed(session, rawFilters = {}) {
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const requestId = randomUUID()
  const now = new Date()
  const [{ candidates, center, fallbackReason, migrationAvailable: poolAvailable }, contextResult, dismissedResult] = await Promise.all([
    queryCandidates(session, filters),
    recommendationContext(session),
    session.supabase.from('discovery_actions').select('event_id,location_id,created_at').eq('profile_id', session.user.id).eq('action', 'dismissed').is('undone_at', null)
  ])
  const [locationPhotos, locationQuality, catalogueMetadata] = await Promise.all([
    loadLocationPhotos(session, candidates, now),
    loadLocationQuality(session, candidates),
    loadLocationCatalogueMetadata(session, candidates)
  ])
  const dismissed = new Set((dismissedResult.data || []).map((item) => item.event_id ? `event:${item.event_id}` : `place:${item.location_id}`))
  const normalized = candidates.map((candidate) => {
    const metadata = candidate.content_kind === 'place' ? catalogueMetadata.get(candidate.content_id) || {} : {}
    const enriched = { ...candidate, ...metadata }
    const timezoneUsable = enriched.source !== 'import' || enriched.timezone_verified === true
    return { ...enriched, open_now: candidate.content_kind === 'place' && timezoneUsable ? isOpenAt(candidate.opening_hours, candidate.timezone, now) : false }
  })
  const evaluated = normalized.map((candidate) => ({ candidate, rejectionReasons: candidateRejectionReasons(candidate, filters, session.profile, now) }))
  const eligible = evaluated.filter((entry) => entry.rejectionReasons.length === 0)
  const fresh = eligible.filter(({ candidate }) => !dismissed.has(`${candidate.content_kind}:${candidate.content_id}`))
  const recycled = fresh.length === 0 && eligible.length > 0 && dismissed.size > 0
  const selected = recycled ? eligible : fresh
  const ranked = selected
    .map(({ candidate }) => formatCandidate(session, candidate, scoreHybridCandidate(candidate, contextResult.context, { filters, experiment: contextResult.experiment, requestId, now }), locationPhotos, locationQuality))
    .sort(compareLocationCandidates)

  // Preserve the existing hard photo-tier ordering, then diversify and suppress exact,
  // parent/child, same-brand, same-address, and near-identical repetition.
  const diversified = diversifyRecommendations(
    ranked,
    Math.min(ranked.length, filters.limit * 4),
    contextResult.context.rankingConfig?.diversity || {}
  )
  const items = suppressCatalogueRepetition(diversified, filters.limit)
  const rejections = evaluated.flatMap(({ candidate, rejectionReasons }) => {
    const reasons = [...rejectionReasons]
    if (!recycled && dismissed.has(`${candidate.content_kind}:${candidate.content_id}`)) reasons.push('previously_dismissed')
    return reasons.length ? [{ content_kind: candidate.content_kind, content_id: candidate.content_id, rejectionReasons: [...new Set(reasons)] }] : []
  }).slice(0, 300)
  const categories = [...new Set(normalized.map((item) => item.category).filter(Boolean))].sort()
  const hybridAvailable = poolAvailable && contextResult.migrationAvailable
  const emptyReason = !center ? 'location_required' : candidates.length === 0 ? 'catalogue_sync_pending' : items.length === 0 ? 'filters' : null
  return {
    requestId,
    impressionKey: impressionKey(filters, now),
    items,
    filters,
    center,
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories,
    recycled,
    emptyReason,
    fallback: Boolean(fallbackReason && fallbackReason !== 'location_required'),
    fallbackReason,
    rankingVersion: hybridAvailable ? (contextResult.context.rankingConfig?.version || HYBRID_RANKING_VERSION) : RULES_FALLBACK_VERSION,
    experiment: contextResult.experiment,
    rejections,
    personalization: {
      behavioral: contextResult.context.preferences?.behavioral_enabled ?? true,
      friendActivity: contextResult.context.preferences?.friend_activity_enabled ?? true,
      vector: hybridAvailable && !contextResult.experiment.holdout && Boolean(contextResult.context.preferences?.vector_enabled ?? true),
      explicitInterestsOnly: Boolean(contextResult.context.preferences?.explicit_interests_only)
    }
  }
}

export async function logDiscoveryImpressions(session, feed) {
  if (!feed.items.length) return
  const request = {
    request_id: feed.requestId,
    profile_id: session.user.id,
    ranking_version: feed.rankingVersion,
    experiment_key: feed.experiment?.experiment || null,
    experiment_variant: feed.experiment?.variant || null,
    holdout: Boolean(feed.experiment?.holdout),
    filters: feed.filters,
    fallback_reason: feed.fallbackReason || null,
    vector_enabled: Boolean(feed.personalization?.vector)
  }
  const requestResult = await session.supabase.from('recommendation_requests').insert(request)
  if (!requestResult.error) {
    const eligibilityRows = (feed.rejections || []).map((item) => ({
      request_id: feed.requestId,
      profile_id: session.user.id,
      content_kind: item.content_kind,
      event_id: item.content_kind === 'event' ? item.content_id : null,
      location_id: item.content_kind === 'place' ? item.content_id : null,
      eligible: false,
      rejection_reasons: item.rejectionReasons || []
    }))
    if (eligibilityRows.length) await session.supabase.from('recommendation_eligibility_logs').insert(eligibilityRows)
    const existingCandidates = await session.supabase.from('recommendation_candidates').select('content_kind,event_id,location_id').eq('profile_id', session.user.id).eq('impression_key', feed.impressionKey)
    const existingTargets = new Set((existingCandidates.data || []).map((item) => item.event_id ? `event:${item.event_id}` : `place:${item.location_id}`))
    const candidateRows = feed.items.slice(0, 100).filter((item) => !existingTargets.has(`${item.content_kind}:${item.content_id}`)).map((item, index) => ({
      request_id: feed.requestId,
      profile_id: session.user.id,
      content_kind: item.content_kind,
      event_id: item.content_kind === 'event' ? item.content_id : null,
      location_id: item.content_kind === 'place' ? item.content_id : null,
      candidate_sources: item.candidateSources || [],
      category: item.category || null,
      distance_m: Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : null,
      host_id: item.host_id || null,
      eligibility: { eligible: true, filters: feed.filters, card_readiness: item.card_readiness },
      score_components: item.scoreComponents || {},
      vector_similarity: item.loggedVectorSimilarity,
      final_score: item.score,
      rank_position: index + 1,
      explanations: item.reasons || [],
      embedding_model_version: item.embedding_model_version || null,
      impression_key: feed.impressionKey
    }))
    if (candidateRows.length) await session.supabase.from('recommendation_candidates').insert(candidateRows)
  }

  const recentSince = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const recent = await session.supabase.from('discovery_impressions').select('content_kind,event_id,location_id').eq('profile_id', session.user.id).gte('created_at', recentSince)
  const already = new Set((recent.data || []).map((item) => item.event_id ? `event:${item.event_id}` : `place:${item.location_id}`))
  const legacyRows = feed.items.slice(0, 60).filter((item) => !already.has(`${item.content_kind}:${item.content_id}`)).map((item, index) => ({
    profile_id: session.user.id,
    request_id: feed.requestId,
    content_kind: item.content_kind,
    event_id: item.content_kind === 'event' ? item.content_id : null,
    location_id: item.content_kind === 'place' ? item.content_id : null,
    rank_position: index + 1,
    score: item.score,
    reasons: item.reasons,
    ranking_version: feed.rankingVersion,
    filters: feed.filters
  }))
  if (legacyRows.length) await session.supabase.from('discovery_impressions').insert(legacyRows)
}

export async function getMapContent(session, bounds) {
  const minLatitude = number(bounds.min_lat)
  const minLongitude = number(bounds.min_lng)
  const maxLatitude = number(bounds.max_lat)
  const maxLongitude = number(bounds.max_lng)
  if ([minLatitude, minLongitude, maxLatitude, maxLongitude].some((value) => value === null)) return []
  const { data, error } = await session.supabase.rpc('content_in_view_v1', {
    min_lat: minLatitude,
    min_lng: minLongitude,
    max_lat: maxLatitude,
    max_lng: maxLongitude,
    max_rows: 300
  })
  return error ? [] : data || []
}
