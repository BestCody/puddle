import { createAdminClient } from '@/lib/supabase/admin'

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
    category: location.kind || 'other',
    title: location.name || 'Location',
    slug: location.slug || null,
    summary: overrides.summary || row.note || location.summary || 'A saved location in your Puddle shortlist.',
    city: location.city || null,
    cover_path: location.cover_path || null,
    href: location.slug ? `/places/${location.slug}` : '/discover',
    ...overrides
  }
}

function memberName(member, userId) {
  if (member.profile_id === userId) return 'You'
  return member.profiles?.display_name || member.profiles?.username || 'Someone'
}

export async function getLocationPlansSnapshot({ supabase, user }) {
  const admin = createAdminClient()
  const [states, visits, memberships, perfectEvents] = await Promise.all([
    queryOr(
      supabase
        .from('user_content_states')
        .select('state,location_id,created_at,locations(id,name,slug,summary,kind,city,cover_path,status)')
        .eq('profile_id', user.id)
        .not('location_id', 'is', null)
        .in('state', ['saved', 'visited'])
        .order('created_at', { ascending: false })
    ),
    queryOr(
      supabase
        .from('location_visits')
        .select('location_id,status,planned_for,visited_at,note,created_at,locations(id,name,slug,summary,kind,city,cover_path,status)')
        .eq('profile_id', user.id)
        .in('status', ['planned', 'visited'])
        .order('created_at', { ascending: false })
    ),
    queryOr(
      supabase
        .from('date_match_members')
        .select('deck_id')
        .eq('profile_id', user.id)
        .order('joined_at', { ascending: false })
        .limit(200)
    ),
    queryOr(
      admin
        .from('discovery_context_outbox')
        .select('location_id,created_at')
        .eq('profile_id', user.id)
        .eq('event_name', 'perfect')
        .order('created_at', { ascending: false })
        .limit(1000)
    )
  ])

  const perfectLocationIds = new Set(perfectEvents.map((item) => item.location_id).filter(Boolean))
  const deckIds = [...new Set(memberships.map((item) => item.deck_id).filter(Boolean))]
  const [matches, members] = deckIds.length
    ? await Promise.all([
        queryOr(
          supabase
            .from('date_match_matches')
            .select('deck_id,location_id,status,planned_for,matched_at,updated_at,locations(id,name,slug,summary,kind,city,cover_path,status)')
            .in('deck_id', deckIds)
            .in('status', ['planned', 'happened'])
            .order('updated_at', { ascending: false })
            .limit(300)
        ),
        queryOr(
          supabase
            .from('date_match_members')
            .select('deck_id,profile_id,profiles(display_name,username)')
            .in('deck_id', deckIds)
            .order('joined_at')
        )
      ])
    : [[], []]

  const participantsByDeck = new Map()
  for (const member of members) {
    const list = participantsByDeck.get(member.deck_id) || []
    list.push(memberName(member, user.id))
    participantsByDeck.set(member.deck_id, list)
  }

  const savedMap = new Map()
  for (const row of states) {
    if (row.state !== 'saved' || !row.locations || row.locations.status !== 'published') continue
    savedMap.set(row.location_id, placeItem(row, {
      saved_at: row.created_at,
      perfect_pick: perfectLocationIds.has(row.location_id)
    }))
  }

  const plannedMap = new Map()
  for (const row of visits) {
    if (row.status !== 'planned' || row.locations?.status !== 'published') continue
    plannedMap.set(row.location_id, placeItem(row, { status: 'planned', planned_for: row.planned_for, plan_source: 'personal', participants: ['You'] }))
  }
  for (const row of matches) {
    if (row.status !== 'planned' || row.locations?.status !== 'published') continue
    plannedMap.set(row.location_id, placeItem(row, { status: 'planned', planned_for: row.planned_for, plan_source: 'date_match', participants: participantsByDeck.get(row.deck_id) || ['You'] }))
  }

  const planned = [...plannedMap.values()].sort((a, b) => new Date(a.planned_for || '9999-12-31') - new Date(b.planned_for || '9999-12-31'))
  for (const item of planned) savedMap.set(item.location_id, { ...(savedMap.get(item.location_id) || {}), ...item })

  const pastMap = new Map()
  for (const row of states) {
    if (row.state !== 'visited' || !row.locations) continue
    pastMap.set(row.location_id, placeItem(row, { status: 'visited', visited_at: row.created_at, visit_source: 'personal' }))
  }
  for (const row of visits) {
    if (row.status !== 'visited' || !row.locations) continue
    pastMap.set(row.location_id, placeItem(row, { status: 'visited', visited_at: row.visited_at || row.created_at, visit_source: 'personal' }))
  }
  for (const row of matches) {
    if (row.status !== 'happened' || !row.locations) continue
    pastMap.set(row.location_id, placeItem(row, { status: 'visited', visited_at: row.updated_at || row.planned_for || row.matched_at, visit_source: 'date_match', participants: participantsByDeck.get(row.deck_id) || ['You'] }))
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
