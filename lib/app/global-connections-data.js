import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'

function placeShape(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || 'Shared place',
    city: row.city || row.region || row.country || null,
    coverPath: openPhotoUrlForHash(row.primary_photo?.content_hash)
  }
}

export async function getGlobalConnectionsSnapshot(session) {
  const [activeResult, adultResult, preferenceResult] = await Promise.all([
    session.supabase.rpc('puddle_tinder_active_v1'),
    session.supabase.rpc('puddle_adult_v1'),
    session.supabase.from('global_connection_preferences').select('discoverable,intent').eq('user_id', session.user.id).maybeSingle()
  ])
  const active = activeResult.data === true
  const adult = adultResult.data === true
  const preference = preferenceResult.data || { discoverable: false, intent: 'either' }
  if (!active || !adult) return { active, adult, preference, people: [], threads: [], unavailable: false }

  const [peopleResult, threadsResult] = await Promise.all([
    preference.discoverable ? session.supabase.rpc('global_like_matches_v1', { max_rows: 48 }) : Promise.resolve({ data: [], error: null }),
    session.supabase.rpc('global_connection_snapshot_v1')
  ])
  const rawPeople = peopleResult.data || []
  const rawThreads = threadsResult.data?.threads || []
  const ids = [...new Set([
    ...rawPeople.map((item) => item.location_id),
    ...rawThreads.map((thread) => thread.locationId || thread.place?.id)
  ].filter(Boolean).map(String))]
  const locations = ids.length ? await getGlobalLocationsByIds(ids, { traceId: session.traceId || null }) : []
  const byId = new Map(locations.map((row) => [String(row.id), placeShape(row)]))

  const people = rawPeople.map((person) => {
    const place = byId.get(String(person.location_id))
    return {
      ...person,
      location_name: place?.name || 'Shared place',
      location_city: place?.city || null,
      cover_path: place?.coverPath || null
    }
  })
  const threads = rawThreads.map((thread) => {
    const locationId = thread.locationId || thread.place?.id
    return { ...thread, place: byId.get(String(locationId)) || { id: locationId, name: 'Shared place', city: null, coverPath: null } }
  })
  return {
    active,
    adult,
    preference,
    people,
    threads,
    unavailable: Boolean(peopleResult.error || threadsResult.error)
  }
}
