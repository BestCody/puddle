async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

function personName(row) {
  return row?.profiles?.display_name || row?.profiles?.username || 'Someone'
}

export async function getMatchesSnapshot({ supabase, user }) {
  const memberships = await queryOr(
    supabase
      .from('date_match_members')
      .select('deck_id,joined_at')
      .eq('profile_id', user.id)
      .order('joined_at', { ascending: false })
      .limit(200)
  )

  const deckIds = [...new Set(memberships.map((row) => row.deck_id).filter(Boolean))]
  if (!deckIds.length) return { rooms: [], matches: [] }

  const [decks, members, matches] = await Promise.all([
    queryOr(
      supabase
        .from('date_match_decks')
        .select('id,title,status,mode,max_members,created_at,updated_at,expires_at')
        .in('id', deckIds)
        .order('updated_at', { ascending: false })
    ),
    queryOr(
      supabase
        .from('date_match_members')
        .select('deck_id,profile_id,completed_at,profiles(display_name,username)')
        .in('deck_id', deckIds)
        .order('joined_at')
    ),
    queryOr(
      supabase
        .from('date_match_matches')
        .select('deck_id,location_id,status,strength,matched_at,planned_for,updated_at,locations(id,name,slug,summary,city,cover_path,status)')
        .in('deck_id', deckIds)
        .order('updated_at', { ascending: false })
        .limit(300)
    )
  ])

  const membersByDeck = new Map()
  for (const member of members) {
    const list = membersByDeck.get(member.deck_id) || []
    list.push({ id: member.profile_id, name: member.profile_id === user.id ? 'You' : personName(member), completed: Boolean(member.completed_at) })
    membersByDeck.set(member.deck_id, list)
  }
  const deckById = new Map(decks.map((deck) => [deck.id, deck]))
  const now = Date.now()
  const rooms = decks
    .filter((deck) => deck.status !== 'archived' && (!deck.expires_at || new Date(deck.expires_at).getTime() > now))
    .map((deck) => ({
      ...deck,
      members: membersByDeck.get(deck.id) || [],
      memberCount: (membersByDeck.get(deck.id) || []).length,
      completedCount: (membersByDeck.get(deck.id) || []).filter((member) => member.completed).length
    }))

  const hydratedMatches = matches
    .filter((row) => row.locations?.status === 'published')
    .map((row) => {
      const deck = deckById.get(row.deck_id) || {}
      return {
        ...row,
        mode: deck.mode || 'date',
        title: row.locations.name,
        city: row.locations.city || null,
        summary: row.locations.summary || null,
        cover_path: row.locations.cover_path || null,
        href: row.locations.slug ? `/places/${row.locations.slug}` : '/matches',
        participants: (membersByDeck.get(row.deck_id) || []).map((member) => member.name)
      }
    })

  return { rooms, matches: hydratedMatches }
}
