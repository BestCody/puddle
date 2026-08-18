import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'

function preferenceLabels(profile) {
  const values = Array.isArray(profile?.interests) ? profile.interests : []
  return values
    .map((value) => String(value || '').replaceAll('_', ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
}

export async function getHomeSnapshot(session) {
  // Saved/planned/past place rows are already hydrated from OpenSearch by
  // getLocationPlansSnapshot. Supabase stores only the relational interaction
  // state and must not be used as a location catalogue or photo registry.
  const plans = await getLocationPlansSnapshot(session)
  const saved = plans.saved
  const planned = plans.planned
  const past = plans.past
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
