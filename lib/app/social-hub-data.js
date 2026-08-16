async function rpcOr(session, name, args = {}, fallback = []) {
  try {
    const result = await session.supabase.rpc(name, args)
    return result.error ? fallback : result.data ?? fallback
  } catch {
    return fallback
  }
}

async function queryOr(query, fallback = []) {
  try {
    const result = await query
    return result.error ? fallback : result.data ?? fallback
  } catch {
    return fallback
  }
}

export async function getSocialHubSnapshot(session, conversationId = null) {
  const [friends, requests, conversations, shared, savedRows] = await Promise.all([
    rpcOr(session, 'social_friends_v1'),
    rpcOr(session, 'social_friend_requests_v1'),
    rpcOr(session, 'social_conversations_v1'),
    rpcOr(session, 'social_shared_locations_v1'),
    queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,created_at,locations(id,name,slug,city,cover_path,status)')
        .eq('profile_id', session.user.id)
        .eq('state', 'saved')
        .order('created_at', { ascending: false })
        .limit(50)
    )
  ])

  const selectedConversation = conversationId
    ? conversations.find((item) => item.conversation_id === conversationId) || null
    : conversations[0] || null
  const messages = selectedConversation
    ? await rpcOr(session, 'social_messages_v1', { target: selectedConversation.conversation_id })
    : []
  const shareableLocations = savedRows
    .filter((row) => row.locations?.status === 'published')
    .map((row) => ({
      id: row.location_id,
      name: row.locations.name,
      slug: row.locations.slug,
      city: row.locations.city,
      cover_path: row.locations.cover_path
    }))

  return {
    friends,
    requests,
    conversations,
    shared,
    shareableLocations,
    selectedConversation,
    messages,
    self: {
      id: session.user.id,
      display_name: session.profile?.display_name || 'You',
      username: session.profile?.username || null,
      avatar_path: session.profile?.avatar_path || null
    }
  }
}
