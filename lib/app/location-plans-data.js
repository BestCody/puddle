async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

function placeItem(row, overrides = {}) {
  const location = row.locations || {}
  return {
    id: row.location_id || location.id,
    location_id: row.location_id || location.id,
    kind: 'place',
    title: location.name || 'Location',
    slug: location.slug || null,
    summary: overrides.summary || row.note || location.summary || 'A saved location in your Puddle shortlist.',
    city: location.city || null,
    cover_path: location.cover_path || null,
    href: location.slug ? `/places/${location.slug}` : '/discover',
    ...overrides
  }
}

export async function getLocationPlansSnapshot({ supabase, user }) {
  const [states, visits] = await Promise.all([
    queryOr(
      supabase
        .from('user_content_states')
        .select('state,location_id,created_at,locations(id,name,slug,summary,city,cover_path,status)')
        .eq('profile_id', user.id)
        .not('location_id', 'is', null)
        .in('state', ['saved', 'visited'])
        .order('created_at', { ascending: false })
    ),
    queryOr(
      supabase
        .from('location_visits')
        .select('location_id,status,planned_for,visited_at,note,created_at,locations(id,name,slug,summary,city,cover_path,status)')
        .eq('profile_id', user.id)
        .in('status', ['planned', 'visited'])
        .order('created_at', { ascending: false })
    )
  ])

  const savedMap = new Map()
  for (const row of states) {
    if (row.state !== 'saved' || !row.locations || row.locations.status !== 'published') continue
    savedMap.set(row.location_id, placeItem(row, { saved_at: row.created_at }))
  }

  const planned = visits
    .filter((row) => row.status === 'planned' && row.locations?.status === 'published')
    .map((row) => placeItem(row, { status: 'planned', planned_for: row.planned_for }))

  for (const item of planned) {
    savedMap.set(item.location_id, { ...(savedMap.get(item.location_id) || {}), ...item })
  }

  const pastMap = new Map()
  for (const row of states) {
    if (row.state !== 'visited' || !row.locations) continue
    pastMap.set(row.location_id, placeItem(row, { status: 'visited', visited_at: row.created_at }))
  }
  for (const row of visits) {
    if (row.status !== 'visited' || !row.locations) continue
    pastMap.set(row.location_id, placeItem(row, { status: 'visited', visited_at: row.visited_at || row.created_at }))
  }

  const saved = [...savedMap.values()].filter((item) => item.status !== 'planned')
  const past = [...pastMap.values()].sort((a, b) => new Date(b.visited_at || 0) - new Date(a.visited_at || 0))

  return {
    saved,
    planned,
    past,
    counts: { saved: saved.length, planned: planned.length, past: past.length }
  }
}
