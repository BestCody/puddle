import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'
import { chooseLocationPhoto, providerPhotoPath } from '@/lib/app/place-photos'

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

function safeCoverPath(value) {
  const path = String(value || '').trim()
  if (!path) return null
  if (path.startsWith('/') || path.startsWith('https://')) return path
  return null
}

function mergeLocationDetails(item, quality, photoRows) {
  const chosenPhoto = chooseLocationPhoto(photoRows || [])
  return {
    ...item,
    summary: quality?.description || item.summary,
    card_tier: Number(quality?.card_tier || 1),
    has_real_photo: Boolean(quality?.has_real_photo),
    rating: Number(quality?.confidence_adjusted_rating || 0),
    rating_count: Number(quality?.rating_count || 0),
    photo_url: safeCoverPath(item.cover_path) || providerPhotoPath(chosenPhoto?.id) || null
  }
}

function preferenceLabels(profile) {
  const values = Array.isArray(profile?.interests) ? profile.interests : []
  return values
    .map((value) => String(value || '').replaceAll('_', ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
}

export async function getHomeSnapshot(session) {
  const plans = await getLocationPlansSnapshot(session)
  const allItems = [...plans.saved, ...plans.planned, ...plans.past]
  const locationIds = [...new Set(allItems.map((item) => item.location_id).filter(Boolean))]

  const [qualityRows, photoRows] = locationIds.length ? await Promise.all([
    queryOr(
      session.supabase
        .from('location_card_quality_v1')
        .select('location_id,description,card_tier,has_real_photo,confidence_adjusted_rating,rating_count')
        .in('location_id', locationIds)
    ),
    queryOr(
      session.supabase
        .from('location_photo_sources')
        .select('id,location_id,source,provider,status,is_primary,is_ai_generated,sort_order,verified_at,expires_at')
        .in('location_id', locationIds)
        .eq('status', 'approved')
    )
  ]) : [[], []]

  const qualityByLocation = new Map(qualityRows.map((row) => [row.location_id, row]))
  const photosByLocation = new Map()
  for (const row of photoRows) {
    const current = photosByLocation.get(row.location_id) || []
    current.push(row)
    photosByLocation.set(row.location_id, current)
  }

  const enrich = (item) => mergeLocationDetails(item, qualityByLocation.get(item.location_id), photosByLocation.get(item.location_id))
  const saved = plans.saved.map(enrich).sort((a, b) => {
    const tier = Number(b.card_tier || 0) - Number(a.card_tier || 0)
    if (tier) return tier
    return Number(b.rating || 0) - Number(a.rating || 0)
  })
  const planned = plans.planned.map(enrich)
  const past = plans.past.map(enrich)
  const now = Date.now()
  const nextPlan = planned.find((item) => !item.planned_for || new Date(item.planned_for).getTime() >= now) || planned[0] || null

  return {
    counts: plans.counts,
    saved: saved.slice(0, 6),
    planned,
    past: past.slice(0, 3),
    nextPlan,
    dateMatchPlanCount: planned.filter((item) => item.plan_source === 'date_match').length,
    city: session.profile?.city || 'your area',
    radiusKm: Number(session.profile?.search_radius_km || 10),
    preferences: preferenceLabels(session.profile)
  }
}
