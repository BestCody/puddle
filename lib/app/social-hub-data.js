import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'

async function rpcRequired(session, name, args = {}) {
  const { data, error } = await session.supabase.rpc(name, args)
  if (error) throw error
  return data
}

const FRIEND_PAGE = 100
const CONVERSATION_PAGE = 30
const MESSAGE_PAGE = 50
const SHARED_PAGE = 50

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
  const requestsPromise = tab === 'add' ? rpcRequired(session, 'social_friend_requests_v1') : Promise.resolve([])
  const friendsPromise = tab === 'messages' ? rpcRequired(session, 'social_friends_v2', { before_name: null, before_id: null, result_limit: FRIEND_PAGE }) : Promise.resolve([])
  const conversationsPromise = tab === 'messages' ? rpcRequired(session, 'social_conversations_v2', { before_sort_at: null, before_conversation_id: null, result_limit: CONVERSATION_PAGE }) : Promise.resolve([])
  const sharedRowsPromise = tab === 'shared' ? rpcRequired(session, 'social_shared_locations_v2', { before_created_at: null, before_share_id: null, result_limit: SHARED_PAGE }) : Promise.resolve([])
  const passActivePromise = tab === 'add' ? rpcRequired(session, 'puddle_tinder_active_v1') : Promise.resolve(false)

  // The selected thread depends on the inbox, but not on the friend list.
  // Start its message read as soon as the inbox arrives.
  const threadPromise = conversationsPromise.then(async (rows) => {
    const conversations = Array.isArray(rows) ? rows : []
    let selectedConversation = tab === 'messages' && conversationId
      ? conversations.find((item) => item.conversation_id === conversationId) || null
      : tab === 'messages' ? conversations[0] || null : null

    if (tab === 'messages' && conversationId && !selectedConversation) {
      const exact = await rpcRequired(session, 'social_conversation_v2', { target: conversationId })
      selectedConversation = exact[0] || null
    }

    const messages = tab === 'messages' && conversationId && selectedConversation
      ? await rpcRequired(session, 'social_messages_v2', {
        target: selectedConversation.conversation_id,
        before_message_id: null,
        result_limit: MESSAGE_PAGE
      })
      : []
    return { selectedConversation, messages }
  })

  // Place metadata depends on visible conversations/messages/shares only. It
  // can overlap the independent friend, request, and membership reads.
  const locationsPromise = Promise.all([conversationsPromise, sharedRowsPromise, threadPromise]).then(([conversations, sharedRows, thread]) => locationMap([
    ...(Array.isArray(sharedRows) ? sharedRows : []).map((row) => row.location_id),
    ...thread.messages.map((row) => row.location_id),
    ...(Array.isArray(conversations) ? conversations : []).map((row) => row.last_location_id),
    thread.selectedConversation?.last_location_id
  ], session.traceId || null))

  const [requests, friends, conversations, sharedRows, passActive, thread, locations] = await Promise.all([
    requestsPromise, friendsPromise, conversationsPromise, sharedRowsPromise, passActivePromise, threadPromise, locationsPromise
  ])
  const requestRows = Array.isArray(requests) ? requests : []
  const friendRows = Array.isArray(friends) ? friends : []
  const conversationRows = Array.isArray(conversations) ? conversations : []
  const sharedLocationRows = Array.isArray(sharedRows) ? sharedRows : []
  const { selectedConversation, messages } = thread

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
  const hydratedConversations = conversationRows.map(hydrateConversation)
  const hydratedSelectedConversation = hydrateConversation(selectedConversation)

  const shared = sharedLocationRows.map((row) => {
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
    requests: requestRows,
    friends: friendRows,
    friendsHasMore: friendRows.length === FRIEND_PAGE,
    conversations: hydratedConversations,
    conversationsHasMore: conversationRows.length === CONVERSATION_PAGE,
    shared,
    sharedHasMore: sharedLocationRows.length === SHARED_PAGE,
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
