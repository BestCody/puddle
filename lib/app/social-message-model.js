export function mergeById(current, incoming, key = 'id') {
  const merged = new Map(current.map((item) => [item[key], item]))
  for (const item of incoming || []) {
    const previous = merged.get(item[key])
    if (!previous) {
      merged.set(item[key], item)
      continue
    }
    const locationKey = key === 'conversation_id' ? 'last_location_id' : 'location_id'
    const metadataFields = key === 'conversation_id'
      ? ['last_location_name', 'last_location_city', 'last_location_slug', 'last_location_cover_path']
      : ['location_name', 'location_city', 'location_slug', 'location_cover_path']
    const previousLocationId = previous[locationKey] || null
    const nextLocationId = item[locationKey] || null
    const next = { ...previous, ...item }
    if (previousLocationId && previousLocationId === nextLocationId) {
      for (const field of metadataFields) {
        if (item[field] == null && previous[field] != null) next[field] = previous[field]
      }
    } else if (previousLocationId !== nextLocationId) {
      for (const field of metadataFields) next[field] = item[field] || null
    }
    merged.set(item[key], next)
  }
  return [...merged.values()]
}

export function sortConversations(rows) {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(left.sort_at || left.last_message_at || left.created_at || '') || 0
    const rightTime = Date.parse(right.sort_at || right.last_message_at || right.created_at || '') || 0
    return rightTime - leftTime || String(right.conversation_id || '').localeCompare(String(left.conversation_id || ''))
  })
}

export function conversationPreview(conversation, openingFriendId) {
  if (conversation.last_message_type === 'location' && conversation.last_location_name) {
    return `Shared ${conversation.last_location_name}`
  }
  return conversation.last_message || (openingFriendId === conversation.friend_id ? 'Opening…' : 'Start a conversation')
}

export function conversationList(snapshot, selected, source = snapshot.conversations || []) {
  const base = selected && !source.some((item) => item.conversation_id === selected.conversation_id)
    ? [selected, ...source]
    : [...source]
  const friendIds = new Set(base.map((item) => item.friend_id).filter(Boolean))
  const waiting = (snapshot.friends || []).filter((friend) => !friendIds.has(friend.id)).map((friend) => ({
    conversation_id: null,
    friend_id: friend.id,
    display_name: friend.display_name,
    username: friend.username,
    avatar_path: friend.avatar_path,
    last_message: null,
    unread_count: 0,
    is_friend_placeholder: true
  }))
  return [...base, ...waiting]
}

