import { getLocationPlansMapSnapshot } from './location-plans-data'
import { openPhotoUrlForHash } from '../media/open-photo-url'
import { validCoordinates } from './optional-number.js'

async function getGlobalLocationsByIds(ids, options = {}) {
  const search = await import('./global-location-search')
  return search.getGlobalLocationsByIds(ids, options)
}

async function rpc(session, name, args = {}) {
  const { data, error } = await session.supabase.rpc(name, args)
  if (error) throw error
  return data
}

async function globalLocations(ids, session) {
  return getGlobalLocationsByIds(ids, { traceId: session.traceId || null })
}

export async function getLocationMapSnapshot(session) {
  const plansPromise = getLocationPlansMapSnapshot(session)
  const passActivePromise = rpc(session, 'puddle_tinder_active_v1')
  // The object-store lookup depends on relationship IDs, not on membership.
  // Start it as soon as the saved/planned lists arrive.
  const locationsPromise = plansPromise.then((plans) => {
    const ids = [...new Set([...plans.saved, ...plans.planned].map((item) => item.location_id).filter(Boolean))]
    return ids.length ? globalLocations(ids, session) : []
  })
  const [plans, passActive, personalLocations] = await Promise.all([plansPromise, passActivePromise, locationsPromise])

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

  const points = personalLocations
    .filter((location) => location.status === 'published' && validCoordinates(location.latitude, location.longitude))
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
  const profileCenter = validCoordinates(session.profile?.latitude, session.profile?.longitude)
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
