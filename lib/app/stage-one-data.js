const demoDiscover = [
  { id: 'demo-event-1', kind: 'EVENT', category: 'LIVE MUSIC', title: 'Neon Garden', meta: 'Friday · 10 PM · The Junction', distance: '2.1 km', badge: 'TONIGHT', symbol: '♫', accent: '#ff4fa3', tags: ['18+', '$18', '3 friends saved'] },
  { id: 'demo-place-1', kind: 'PLACE', category: 'LATE-NIGHT CAFÉ', title: 'Moonlight Café', meta: 'Open until 1 AM · espresso, vinyl, soft lights', distance: '1.2 km', badge: 'OPEN NOW', symbol: '☕', accent: '#ffd86b', tags: ['Cozy', '$$', 'Wi-Fi'] },
  { id: 'demo-event-2', kind: 'EVENT', category: 'ART', title: 'Midnight Museum', meta: 'Saturday · 9 PM · West end', distance: '4.8 km', badge: 'WEEKEND', symbol: '✦', accent: '#7c4dff', tags: ['Free', 'All ages', 'Accessible'] },
  { id: 'demo-place-2', kind: 'PLACE', category: 'OUTDOORS', title: 'Sunset Steps', meta: 'Scenic lookout · best around golden hour', distance: '3.4 km', badge: 'LOCAL GEM', symbol: '☀', accent: '#72e6c1', tags: ['Free', 'Outdoors', 'Great views'] }
]

function eventToCard(event) {
  return {
    id: event.id,
    kind: 'EVENT',
    category: String(event.category || 'EVENT').toUpperCase(),
    title: event.title,
    meta: event.starts_at ? new Date(event.starts_at).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Date coming soon',
    distance: event.locations?.city || 'Near you',
    badge: 'FOR YOU',
    symbol: '✦',
    accent: '#ff4fa3',
    tags: [event.price_from_cents ? `$${Math.round(event.price_from_cents / 100)}` : 'Free', event.min_age ? `${event.min_age}+` : 'All ages', 'Event']
  }
}

function locationToCard(location) {
  return {
    id: location.id,
    kind: 'PLACE',
    category: String(location.kind || 'PLACE').replaceAll('_', ' ').toUpperCase(),
    title: location.name,
    meta: location.summary || [location.neighborhood, location.city].filter(Boolean).join(' · ') || 'A place worth discovering',
    distance: location.city || 'Near you',
    badge: 'EXPLORE',
    symbol: '⌖',
    accent: '#72e6c1',
    tags: [location.price_level ? '$'.repeat(location.price_level) : 'Local', ...(location.amenities || []).slice(0, 2)]
  }
}

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    if (error) return fallback
    return data || fallback
  } catch {
    return fallback
  }
}

export async function getStageOneSnapshot({ supabase, user }) {
  const [events, locations, states, hosts, friendships, messages] = await Promise.all([
    queryOr(supabase.from('events').select('id,title,category,starts_at,price_from_cents,min_age,location_id,locations(city)').eq('status', 'published').order('starts_at').limit(8)),
    queryOr(supabase.from('locations').select('id,name,kind,summary,city,neighborhood,price_level,amenities').eq('status', 'published').limit(8)),
    queryOr(supabase.from('user_content_states').select('state,event_id,location_id').eq('profile_id', user.id)),
    queryOr(supabase.from('host_profiles').select('id,name,slug,kind,verification_status').order('created_at', { ascending: false }).limit(8)),
    queryOr(supabase.from('friendships').select('state').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)),
    queryOr(supabase.from('conversation_members').select('conversation_id').eq('profile_id', user.id))
  ])

  const realDiscover = [...events.map(eventToCard), ...locations.map(locationToCard)]
  const counts = states.reduce((result, item) => {
    result[item.state] = (result[item.state] || 0) + 1
    return result
  }, {})

  return {
    discover: realDiscover.length ? realDiscover : demoDiscover,
    locations,
    events,
    hosts,
    counts,
    friendCount: friendships.filter((item) => item.state === 'accepted').length,
    pendingFriendCount: friendships.filter((item) => item.state === 'pending').length,
    conversationCount: messages.length,
    usingDemoContent: realDiscover.length === 0
  }
}

export { demoDiscover }
