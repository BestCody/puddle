import { getLocationPlansSnapshot } from './location-plans-data'
import { chooseLocationPhoto, providerPhotoPath } from './place-photos'

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

function publicMediaUrl(supabase, path) {
  const value = String(path || '').trim()
  if (!value) return null
  if (value.startsWith('/') || value.startsWith('https://')) return value
  return supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

export async function getLocationMapSnapshot(session) {
  const plans = await getLocationPlansSnapshot(session)
  const memberships = await queryOr(
    session.supabase.from('date_match_members').select('deck_id').eq('profile_id', session.user.id).limit(250)
  )
  const deckIds = [...new Set(memberships.map((row) => row.deck_id).filter(Boolean))]
  const sharedMatches = deckIds.length ? await queryOr(
    session.supabase
      .from('date_match_matches')
      .select('deck_id,location_id,status,strength,planned_for,updated_at,date_match_decks(mode)')
      .in('deck_id', deckIds)
      .in('status', ['matched', 'planned', 'happened'])
      .order('updated_at', { ascending: false })
      .limit(400)
  ) : []

  const statesByLocation = new Map()
  function addState(locationId, state, payload = {}) {
    if (!locationId) return
    const current = statesByLocation.get(locationId) || { location_id: locationId, states: new Set(), match: null, plan: null }
    current.states.add(state)
    if (state === 'matched') current.match = payload
    if (state === 'planned') current.plan = payload
    statesByLocation.set(locationId, current)
  }

  for (const item of plans.saved) addState(item.location_id, 'saved')
  for (const item of plans.planned) addState(item.location_id, 'planned', { planned_for: item.planned_for, source: item.plan_source })
  for (const match of sharedMatches) {
    addState(match.location_id, 'matched', { strength: match.strength, mode: match.date_match_decks?.mode || 'date', status: match.status })
    if (match.status === 'planned') addState(match.location_id, 'planned', { planned_for: match.planned_for, source: match.date_match_decks?.mode || 'date' })
  }

  const locationIds = [...statesByLocation.keys()]
  if (!locationIds.length) return { points: [], counts: { saved: 0, matched: 0, planned: 0 }, center: null }

  const [locations, photoRows] = await Promise.all([
    queryOr(
      session.supabase
        .from('locations')
        .select('id,slug,name,summary,kind,neighborhood,city,latitude,longitude,cover_path,status,visibility,has_private_address')
        .in('id', locationIds)
        .eq('status', 'published')
        .eq('visibility', 'public')
    ),
    queryOr(
      session.supabase
        .from('location_photo_sources')
        .select('id,location_id,source,provider,status,is_primary,is_ai_generated,sort_order,verified_at,expires_at')
        .in('location_id', locationIds)
        .eq('status', 'approved')
    )
  ])

  const photosByLocation = new Map()
  for (const row of photoRows) {
    const current = photosByLocation.get(row.location_id) || []
    current.push(row)
    photosByLocation.set(row.location_id, current)
  }

  const points = locations
    .filter((location) => !location.has_private_address && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)))
    .map((location) => {
      const state = statesByLocation.get(location.id)
      const chosenPhoto = chooseLocationPhoto(photosByLocation.get(location.id) || [])
      return {
        id: location.id,
        location_id: location.id,
        title: location.name,
        summary: location.summary || `A ${String(location.kind || 'location').replaceAll('_', ' ')} in ${location.neighborhood || location.city || 'your area'}.`,
        category: location.kind,
        neighborhood: location.neighborhood,
        city: location.city,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        href: `/places/${location.slug}`,
        photo_url: publicMediaUrl(session.supabase, location.cover_path) || providerPhotoPath(chosenPhoto?.id) || null,
        states: [...state.states],
        match: state.match,
        plan: state.plan
      }
    })

  const counts = {
    saved: points.filter((point) => point.states.includes('saved')).length,
    matched: points.filter((point) => point.states.includes('matched')).length,
    planned: points.filter((point) => point.states.includes('planned')).length
  }
  const center = points.length ? {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length
  } : null

  return { points, counts, center }
}
