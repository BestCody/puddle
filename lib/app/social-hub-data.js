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

const FRIEND_PAGE = 40
const CONVERSATION_PAGE = 30
const MESSAGE_PAGE = 50

export async function getSocialHubSnapshot(session, conversationId = null) {
  const [friends, requests, conversations, shared, savedRows, passActive] = await Promise.all([
    rpcOr(session, 'social_friends_v2', { before_name: null, before_id: null, result_limit: FRIEND_PAGE }),
    rpcOr(session, 'social_friend_requests_v1'),
    rpcOr(session, 'social_conversations_v2', { before_sort_at: null, before_conversation_id: null, result_limit: CONVERSATION_PAGE }),
    rpcOr(session, 'social_shared_locations_v1'),
    queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,created_at,locations(id,name,slug,city,cover_path,status)')
        .eq('profile_id', session.user.id)
        .eq('state', 'saved')
        .order('created_at', { ascending: false })
        .limit(50)
    ),
    rpcOr(session, 'puddle_tinder_active_v1', {}, false)
  ])

  let selectedConversation = conversationId
    ? conversations.find((item) => item.conversation_id === conversationId) || null
    : conversations[0] || null

  // A direct link can target a conversation older than the first inbox page.
  if (conversationId && !selectedConversation) {
    const exact = await rpcOr(session, 'social_conversation_v2', { target: conversationId }, [])
    selectedConversation = exact[0] || null
  }

  const messages = selectedConversation
    ? await rpcOr(session, 'social_messages_v2', {
      target: selectedConversation.conversation_id,
      before_message_id: null,
      result_limit: MESSAGE_PAGE
    })
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
    friendsHasMore: friends.length === FRIEND_PAGE,
    requests,
    conversations,
    conversationsHasMore: conversations.length === CONVERSATION_PAGE,
    shared,
    shareableLocations,
    selectedConversation,
    messages,
    messagesHasMore: messages.length === MESSAGE_PAGE,
    passActive: Boolean(passActive),
    self: {
      id: session.user.id,
      display_name: session.profile?.display_name || 'You',
      username: session.profile?.username || null,
      avatar_path: session.profile?.avatar_path || null
    }
  }
}
