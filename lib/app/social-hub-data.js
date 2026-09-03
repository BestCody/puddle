import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'

async function rpcOr(session, name, args = {}, fallback = []) {
  try {
    const result = await session.supabase.rpc(name, args)
    return result.error ? fallback : result.data ?? fallback
  } catch {
    return fallback
  }
}

const FRIEND_PAGE = 100
const CONVERSATION_PAGE = 30
const MESSAGE_PAGE = 50

function locationShape(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || 'Shared place',
    slug: row.slug || null,
    city: row.city || row.region || row.country || null,
    cover_path: openPhotoUrlForHash(row.primary_photo?.content_hash)
  }
}

async function locationMap(ids, traceId) {
  const unique = [...new Set((ids || []).map(String).filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await getGlobalLocationsByIds(unique, { traceId })
  return new Map(rows.map((row) => [String(row.id), locationShape(row)]))
}

export async function getSocialHubSnapshot(session, conversationId = null, { tab = 'messages' } = {}) {
  const [requests, friends, conversations, sharedRows, passActive] = await Promise.all([
    tab === 'add' ? rpcOr(session, 'social_friend_requests_v1') : Promise.resolve([]),
    tab === 'messages' ? rpcOr(session, 'social_friends_v2', { before_name: null, before_id: null, result_limit: FRIEND_PAGE }) : Promise.resolve([]),
    ['messages', 'shared'].includes(tab) ? rpcOr(session, 'social_conversations_v2', { before_sort_at: null, before_conversation_id: null, result_limit: CONVERSATION_PAGE }) : Promise.resolve([]),
    tab === 'shared' ? rpcOr(session, 'social_shared_locations_v1') : Promise.resolve([]),
    tab === 'add' ? rpcOr(session, 'puddle_tinder_active_v1', {}, false) : Promise.resolve(false)
  ])

  let selectedConversation = tab === 'messages' && conversationId
    ? conversations.find((item) => item.conversation_id === conversationId) || null
    : tab === 'messages'
      ? conversations[0] || null
      : null

  if (tab === 'messages' && conversationId && !selectedConversation) {
    const exact = await rpcOr(session, 'social_conversation_v2', { target: conversationId }, [])
    selectedConversation = exact[0] || null
  }

  const messages = tab === 'messages' && conversationId && selectedConversation
    ? await rpcOr(session, 'social_messages_v2', {
      target: selectedConversation.conversation_id,
      before_message_id: null,
      result_limit: MESSAGE_PAGE
    })
    : []

  // Hydrate only places visible in the current Messages/Shared screens. The
  // saved-place picker remains lazy and loads only when its menu opens.
  const locations = await locationMap([
    ...sharedRows.map((row) => row.location_id),
    ...messages.map((row) => row.location_id),
    ...conversations.map((row) => row.last_location_id),
    selectedConversation?.last_location_id
  ], session.traceId || null)

  const hydrateConversation = (row) => {
    if (!row) return row
    const place = locations.get(String(row.last_location_id || ''))
    return {
      ...row,
      last_location_name: place?.name || null,
      last_location_city: place?.city || null,
      last_location_slug: place?.slug || null,
      last_location_cover_path: place?.cover_path || null
    }
  }
  const hydratedConversations = conversations.map(hydrateConversation)
  const hydratedSelectedConversation = hydrateConversation(selectedConversation)

  const shared = sharedRows.map((row) => {
    const place = locations.get(String(row.location_id))
    return {
      ...row,
      location_name: place?.name || 'Shared place',
      location_city: place?.city || null,
      location_slug: place?.slug || null,
      location_cover_path: place?.cover_path || null
    }
  })

  const hydratedMessages = messages.map((row) => {
    if (!row.location_id) return row
    const place = locations.get(String(row.location_id))
    return {
      ...row,
      location_name: place?.name || 'Shared place',
      location_city: place?.city || null,
      location_slug: place?.slug || null,
      location_cover_path: place?.cover_path || null
    }
  })

  return {
    requests,
    friends,
    friendsHasMore: friends.length === FRIEND_PAGE,
    conversations: hydratedConversations,
    conversationsHasMore: conversations.length === CONVERSATION_PAGE,
    shared,
    shareableLocations: [],
    selectedConversation: hydratedSelectedConversation,
    messages: hydratedMessages,
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
