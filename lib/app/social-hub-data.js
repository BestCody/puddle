async function rpcOr(session, name, args = {}, fallback = []) {
  try {
    const result = await session.supabase.rpc(name, args)
    return result.error ? fallback : result.data ?? fallback
  } catch {
    return fallback
  }
}

export async function getSocialHubSnapshot(session, conversationId = null) {
  const [friends, requests, conversations, shared] = await Promise.all([
    rpcOr(session, 'social_friends_v1'),
    rpcOr(session, 'social_friend_requests_v1'),
    rpcOr(session, 'social_conversations_v1'),
    rpcOr(session, 'social_shared_locations_v1')
  ])

  const selectedConversation = conversationId
    ? conversations.find((item) => item.conversation_id === conversationId) || null
    : conversations[0] || null
  const messages = selectedConversation
    ? await rpcOr(session, 'social_messages_v1', { target: selectedConversation.conversation_id })
    : []

  return {
    friends,
    requests,
    conversations,
    shared,
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
