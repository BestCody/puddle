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
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)))
}

function distanceLabel(distance) {
  if (distance === null || distance === undefined) return 'Distance unavailable'
  return Number(distance) < 1000 ? `${Math.round(Number(distance))} m` : `${(Number(distance) / 1000).toFixed(1)} km`
}

function displayName(profile, index) {
  return String(profile?.display_name || profile?.username || `Person ${index + 1}`).trim().slice(0, 60)
}

function voteSummary(swipes = []) {
  return {
    positiveCount: swipes.filter((row) => row.choice === 'save' || row.choice === 'perfect').length,
    perfectCount: swipes.filter((row) => row.choice === 'perfect').length,
    passCount: swipes.filter((row) => row.choice === 'pass').length,
    voteCount: swipes.length
  }
}

function groupBy(rows, key) {
  const grouped = new Map()
  for (const row of rows || []) {
    const value = row?.[key]
    if (!value) continue
    const current = grouped.get(value) || []
    current.push(row)
    grouped.set(value, current)
  }
  return grouped
}

function formatLocation(supabase, row, deck, photo, qualityRow, reveal, now) {
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
  const notes = reveal?.notes || []
  const item = {
    content_kind: 'place',
    content_id: location.id,
    slug: location.slug,
    title: location.name,
    summary: quality.description,
    description_source: quality.descriptionSource,
    category: location.kind,
    neighborhood: location.neighborhood,
    city: location.city,
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
    partner_note: notes[0]?.note || null,
    partner_choice: notes[0]?.choice || null,
    group_notes: notes,
    group_choice_summary: reveal?.summary || null
  }
  item.puddle_pick_reasons = item.is_puddle_pick ? puddlePickReasons(item) : []
  return item
}

export async function getDateMatchSnapshotV2(session, rawToken) {
  const token = String(rawToken || '').trim()
  if (!TOKEN_PATTERN.test(token)) return null

  const joined = await session.supabase.rpc('join_date_match_v1', { invite_token: token })
  const deckId = joined.data?.deckId || joined.data?.deck_id
  if (joined.error || !deckId) return null

  const snapshotResult = await session.supabase.rpc('get_date_match_snapshot_v2', { target_deck: deckId })
  const bundle = snapshotResult.data
  if (snapshotResult.error || !bundle?.deck) return null

  const deck = bundle.deck
  const itemRows = Array.isArray(bundle.items) ? bundle.items : []
  const locations = Array.isArray(bundle.locations) ? bundle.locations : []
  const locationMap = new Map(locations.map((location) => [location.id, location]))
  const rows = itemRows
    .map((row) => ({ ...row, location: locationMap.get(row.location_id) }))
    .filter((row) => row.location?.status === 'published' && row.location?.visibility === 'public' && !row.location?.has_private_address)

  const members = Array.isArray(bundle.members) ? bundle.members : []
  const profileMap = new Map((Array.isArray(bundle.profiles) ? bundle.profiles : []).map((profile) => [profile.id, profile]))
  const hydratedMembers = members.map((member, index) => ({
    profile_id: member.profile_id,
    role: member.role,
    joined_at: member.joined_at,
    completed: Boolean(member.completed_at),
    isYou: member.profile_id === session.user.id,
    name: member.profile_id === session.user.id ? 'You' : displayName(profileMap.get(member.profile_id), index)
  }))

  const matches = Array.isArray(bundle.matches) ? bundle.matches : []
  const swipesByLocation = groupBy(Array.isArray(bundle.revealedSwipes) ? bundle.revealedSwipes : [], 'location_id')
  const reveals = new Map()
  for (const match of matches) {
    const swipes = swipesByLocation.get(match.location_id) || []
    const notes = swipes
      .filter((swipe) => swipe.profile_id !== session.user.id && swipe.note && ['save', 'perfect'].includes(swipe.choice))
      .map((swipe, index) => ({
        name: displayName(profileMap.get(swipe.profile_id), index),
        note: String(swipe.note).slice(0, 280),
        choice: swipe.choice
      }))
    reveals.set(match.location_id, { summary: voteSummary(swipes), notes })
  }

  const photosByLocation = groupBy(Array.isArray(bundle.photos) ? bundle.photos : [], 'location_id')
  const qualityMap = new Map((Array.isArray(bundle.quality) ? bundle.quality : []).map((quality) => [quality.location_id, quality]))
  const now = new Date()
  const items = rows.map((row) => formatLocation(
    session.supabase,
    row,
    deck,
    chooseLocationPhoto(photosByLocation.get(row.location_id) || [], now),
    qualityMap.get(row.location_id),
    reveals.get(row.location_id),
    now
  ))

  const ownSwipes = new Map((Array.isArray(bundle.ownSwipes) ? bundle.ownSwipes : []).map((row) => [row.location_id, row]))
  const feedback = new Map((Array.isArray(bundle.feedback) ? bundle.feedback : []).map((row) => [row.location_id, row]))
  const hydratedMatches = matches.map((match) => ({
    ...match,
    feedback: feedback.get(match.location_id) || null,
    voteSummary: reveals.get(match.location_id)?.summary || null
  }))

  return {
    token,
    roomVersion: Number(bundle.version || 1),
    deck: {
      ...deck,
      roomVersion: Number(bundle.version || 1),
      role: joined.data?.role || null,
      mode: deck.mode || joined.data?.mode || 'date',
      maxMembers: Number(deck.max_members || joined.data?.maxMembers || 2),
      partnerJoined: members.length >= 2,
      memberCount: members.length,
      completedCount: members.filter((member) => member.completed_at).length,
      itemCount: items.length,
      isFull: members.length >= Number(deck.max_members || 2),
      members: hydratedMembers
    },
    items: items.map((item) => ({
      ...item,
      own_choice: ownSwipes.get(item.content_id)?.choice || null,
      own_note: ownSwipes.get(item.content_id)?.note || null
    })),
    matches: hydratedMatches
  }
}
