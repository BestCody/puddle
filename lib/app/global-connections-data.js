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
  return {
    active,
    adult,
    preference,
    people: peopleResult.data || [],
    threads: threadsResult.data?.threads || [],
    unavailable: Boolean(peopleResult.error || threadsResult.error)
  }
}
