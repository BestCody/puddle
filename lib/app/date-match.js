import { createAdminClient } from '@/lib/supabase/admin'
import { chooseLocationPhoto, photoMetadata, providerPhotoPath } from './place-photos'
import { isOpenAt } from './discovery'
import { puddlePickReasons } from './date-match-rules'
import { buildFactualLocationDescription, evaluateLocationCardQuality, normalizeRatingSummary, ratingLabel } from './location-quality'

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i

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

function distanceLabel(distance) {
  if (distance === null || distance === undefined) return 'Distance unavailable'
  return Number(distance) < 1000 ? `${Math.round(Number(distance))} m` : `${(Number(distance) / 1000).toFixed(1)} km`
}

async function loadLocationPhotos(supabase, locationIds, now) {
  if (!locationIds.length) return new Map()
  const rows = []
  for (let index = 0; index < locationIds.length; index += 100) {
    const { data, error } = await supabase
      .from('location_photo_sources')
      .select('id,location_id,source,provider,attribution_text,attribution_url,license_code,width,height,is_primary,sort_order,status,is_ai_generated,verified_at,expires_at')
      .in('location_id', locationIds.slice(index, index + 100))
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
  return new Map([...grouped].map(([locationId, candidates]) => [locationId, chooseLocationPhoto(candidates, now)]))
}

async function loadLocationQuality(supabase, locationIds) {
  if (!locationIds.length) return new Map()
  const rows = []
  for (let index = 0; index < locationIds.length; index += 100) {
    const { data, error } = await supabase
      .from('location_card_quality_v1')
      .select('location_id,description,description_source,average_rating,confidence_adjusted_rating,rating_count,happened_count,last_feedback_at')
      .in('location_id', locationIds.slice(index, index + 100))
    if (error) return new Map()
    rows.push(...(data || []))
  }
  return new Map(rows.map((row) => [row.location_id, row]))
}

function formatLocation(supabase, row, deck, photo, qualityRow, partnerReveal, now) {
  const location = row.location || {}
  const puddlePhotoUrl = publicMediaUrl(supabase, location.cover_path)
  const metadata = photoMetadata(photo)
  const photoUrl = puddlePhotoUrl || providerPhotoPath(metadata?.id)
  const distance = haversineMeters(deck.center_latitude, deck.center_longitude, location.latitude, location.longitude)
  const description = qualityRow?.description || location.summary || buildFactualLocationDescription(location)
  const quality = evaluateLocationCardQuality(location, {
    description,
    descriptionSource: qualityRow?.description_source || (location.summary ? 'location_summary' : 'generated_factual'),
    hasRealPhoto: Boolean(photoUrl)
  })
  const rating = normalizeRatingSummary(qualityRow || {})
  const item = {
    content_kind: 'place',
    content_id: location.id,
    slug: location.slug,
    title: location.name,
    summary: quality.description,
    description_source: quality.descriptionSource,
    category: location.kind,
    timezone: location.timezone,
    price_level: location.price_level,
    accessibility: location.accessibility || {},
    amenities: location.amenities || [],
    opening_hours: location.opening_hours || {},
    latitude: location.latitude,
    longitude: location.longitude,
    distance_m: distance,
    distanceLabel: distanceLabel(distance),
    priceLabel: location.price_level ? '$'.repeat(Number(location.price_level)) : 'Price varies',
    open_now: isOpenAt(location.opening_hours, location.timezone, now),
    href: `/places/${location.slug}`,
    cover_url: photoUrl,
    photo_url: photoUrl,
    has_real_photo: quality.hasRealPhoto,
    photo_source: puddlePhotoUrl ? 'puddle_media' : metadata?.source || null,
    photo_provider: puddlePhotoUrl ? 'puddle' : metadata?.provider || null,
    photo_attribution: metadata?.attribution || null,
    photo_attribution_url: metadata?.attributionUrl || null,
    photo_license: metadata?.license || null,
    card_tier: quality.cardTier,
    card_readiness: quality.cardTier >= 3 ? 'premium' : quality.cardTier === 2 ? 'standard' : 'fallback',
    content_quality_score: quality.contentQualityScore,
    average_rating: rating.averageRating,
    confidence_adjusted_rating: rating.confidenceAdjustedRating,
    rating_count: rating.ratingCount,
    rating_score: rating.ratingScore,
    rating_label: ratingLabel({ rating_count: rating.ratingCount, confidence_adjusted_rating: rating.confidenceAdjustedRating }),
    sort_order: row.sort_order,
    is_puddle_pick: Boolean(row.is_puddle_pick),
    partner_note: partnerReveal?.note || null,
    partner_choice: partnerReveal?.choice || null
  }
  item.puddle_pick_reasons = item.is_puddle_pick ? puddlePickReasons(item) : []
  return item
}

export async function getDateMatchSnapshot(session, rawToken) {
  const token = String(rawToken || '').trim()
  if (!TOKEN_PATTERN.test(token)) return null

  const joined = await session.supabase.rpc('join_date_match_v1', { invite_token: token })
  const deckId = joined.data?.deckId || joined.data?.deck_id
  if (joined.error || !deckId) return null

  const admin = createAdminClient()
  const now = new Date()
  const [deckResult, membersResult, itemRowsResult, swipesResult, matchesResult, feedbackResult] = await Promise.all([
    admin.from('date_match_decks').select('id,created_by,title,status,center_latitude,center_longitude,created_at,updated_at,expires_at').eq('id', deckId).maybeSingle(),
    admin.from('date_match_members').select('profile_id,role,joined_at').eq('deck_id', deckId).order('joined_at'),
    admin.from('date_match_items').select('location_id,sort_order,is_puddle_pick').eq('deck_id', deckId).order('sort_order'),
    admin.from('date_match_swipes').select('location_id,choice,note,updated_at').eq('deck_id', deckId).eq('profile_id', session.user.id),
    admin.from('date_match_matches').select('location_id,strength,status,matched_at,planned_for,updated_at').eq('deck_id', deckId).order('strength', { ascending: false }),
    admin.from('date_match_feedback').select('location_id,happened,rating,updated_at').eq('deck_id', deckId).eq('profile_id', session.user.id)
  ])

  const deck = deckResult.data
  const itemRows = itemRowsResult.data || []
  if (!deck || deckResult.error || membersResult.error || itemRowsResult.error || swipesResult.error || matchesResult.error || feedbackResult.error) return null

  const locationIds = itemRows.map((row) => row.location_id)
  const locationsResult = locationIds.length
    ? await admin.from('locations').select('id,slug,name,summary,kind,neighborhood,city,timezone,price_level,accessibility,amenities,opening_hours,latitude,longitude,cover_path,status,visibility,has_private_address').in('id', locationIds)
    : { data: [], error: null }
  if (locationsResult.error) return null

  const locationMap = new Map((locationsResult.data || []).map((location) => [location.id, location]))
  const rows = itemRows
    .map((row) => ({ ...row, location: locationMap.get(row.location_id) }))
    .filter((row) => row.location?.status === 'published' && row.location?.visibility === 'public' && !row.location?.has_private_address)

  const matches = matchesResult.data || []
  const matchedLocationIds = matches.map((match) => match.location_id)
  const partnerSwipesResult = matchedLocationIds.length
    ? await admin.from('date_match_swipes').select('location_id,choice,note').eq('deck_id', deckId).neq('profile_id', session.user.id).in('location_id', matchedLocationIds)
    : { data: [], error: null }
  if (partnerSwipesResult.error) return null

  const targetIds = rows.map((row) => row.location_id)
  const [photos, quality] = await Promise.all([
    loadLocationPhotos(admin, targetIds, now),
    loadLocationQuality(admin, targetIds)
  ])
  const reveals = new Map((partnerSwipesResult.data || []).map((row) => [row.location_id, row]))
  const items = rows.map((row) => formatLocation(admin, row, deck, photos.get(row.location_id), quality.get(row.location_id), reveals.get(row.location_id), now))
  const ownSwipes = new Map((swipesResult.data || []).map((row) => [row.location_id, row]))
  const feedback = new Map((feedbackResult.data || []).map((row) => [row.location_id, row]))
  const hydratedMatches = matches.map((match) => ({ ...match, feedback: feedback.get(match.location_id) || null }))
  const members = membersResult.data || []

  return {
    token,
    deck: {
      ...deck,
      role: joined.data?.role || null,
      partnerJoined: members.length >= 2,
      memberCount: members.length,
      itemCount: items.length
    },
    items: items.map((item) => ({ ...item, own_choice: ownSwipes.get(item.content_id)?.choice || null, own_note: ownSwipes.get(item.content_id)?.note || null })),
    matches: hydratedMatches
  }
}
