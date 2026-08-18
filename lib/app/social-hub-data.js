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

async function queryOr(query, fallback = []) {
  try {
    const result = await query
    return result.error ? fallback : result.data ?? fallback
  } catch {
    return fallback
  }
}

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

export async function getSocialHubSnapshot(session, conversationId = null) {
  const [requests, conversations, sharedRows, savedRows, passActive] = await Promise.all([
    rpcOr(session, 'social_friend_requests_v1'),
    rpcOr(session, 'social_conversations_v2', { before_sort_at: null, before_conversation_id: null, result_limit: CONVERSATION_PAGE }),
    rpcOr(session, 'social_shared_locations_v1'),
    queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,created_at')
        .eq('profile_id', session.user.id)
        .eq('state', 'saved')
        .not('location_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)
    ),
    rpcOr(session, 'puddle_tinder_active_v1', {}, false)
  ])

  let selectedConversation = conversationId
    ? conversations.find((item) => item.conversation_id === conversationId) || null
    : conversations[0] || null

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

  const locations = await locationMap([
    ...sharedRows.map((row) => row.location_id),
    ...savedRows.map((row) => row.location_id),
    ...messages.map((row) => row.location_id)
  ], session.traceId || null)

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

  const shareableLocations = savedRows.flatMap((row) => {
    const place = locations.get(String(row.location_id))
    if (!place) return []
    return [{ id: row.location_id, ...place }]
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
    conversations,
    conversationsHasMore: conversations.length === CONVERSATION_PAGE,
    shared,
    shareableLocations,
    selectedConversation,
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
