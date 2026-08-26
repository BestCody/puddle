import { getLocationPlansSnapshot } from './location-plans-data'
import { openPhotoUrlForHash } from '../media/open-photo-url'

async function getGlobalLocationsByIds(ids, options = {}) {
  const search = await import('./global-location-search')
  return search.getGlobalLocationsByIds(ids, options)
}

async function rpcOr(session, name, args = {}, fallback = []) {
  try {
    const { data, error } = await session.supabase.rpc(name, args)
    return error ? fallback : data ?? fallback
  } catch {
    return fallback
  }
}

async function globalLocationsOr(ids, session, fallback = []) {
  try {
    return await getGlobalLocationsByIds(ids, { traceId: session.traceId || null })
  } catch {
    return fallback
  }
}

export async function getLocationMapSnapshot(session) {
  const [plans, passActive] = await Promise.all([
    getLocationPlansSnapshot(session),
    rpcOr(session, 'puddle_tinder_active_v1', {}, false)
  ])

  const statesByLocation = new Map()
  function addState(locationId, state, payload = {}) {
    if (!locationId) return
    const current = statesByLocation.get(locationId) || { location_id: locationId, states: new Set(), plan: null }
    current.states.add(state)
    if (state === 'planned') current.plan = payload
    statesByLocation.set(locationId, current)
  }

  for (const item of plans.saved) addState(item.location_id, 'saved')
  for (const item of plans.planned) addState(item.location_id, 'planned', { planned_for: item.planned_for, source: item.plan_source })

  const personalLocationIds = [...statesByLocation.keys()]
  const personalLocations = personalLocationIds.length
    ? await globalLocationsOr(personalLocationIds, session)
    : []

  const points = personalLocations
    .filter((location) => location.status === 'published' && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)))
    .map((location) => {
      const state = statesByLocation.get(location.id)
      const category = location.category || location.kind || 'location'
      const photoHash = location.primary_photo && typeof location.primary_photo === 'object'
        ? location.primary_photo.content_hash
        : null
      return {
        id: location.id,
        location_id: location.id,
        title: location.name,
        summary: location.summary || location.description || `A ${String(category).replaceAll('_', ' ')} in ${location.neighborhood || location.city || 'your area'}.`,
        category,
        neighborhood: location.neighborhood || null,
        city: location.city || null,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        href: location.slug ? `/plans/${location.slug}` : null,
        photo_url: openPhotoUrlForHash(photoHash),
        states: state ? [...state.states] : [],
        match: null,
        plan: state?.plan || null
      }
    })

  const counts = {
    saved: points.filter((point) => point.states.includes('saved')).length,
    matched: 0,
    planned: points.filter((point) => point.states.includes('planned')).length
  }
  const profileLatitude = Number(session.profile?.latitude)
  const profileLongitude = Number(session.profile?.longitude)
  const profileCenter = Number.isFinite(profileLatitude) && Number.isFinite(profileLongitude)
    ? { latitude: profileLatitude, longitude: profileLongitude }
    : null
  const center = points.length ? {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length
  } : profileCenter

  return {
    points,
    counts,
    center,
    heatmap: [],
    passActive: Boolean(passActive)
  }
}
