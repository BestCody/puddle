import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { unstable_cache } from 'next/cache'
import { filterModeratedLocationRows } from './location-moderation-overlay'
import {
  SERVER_LATENCY_BUDGET_MS,
  createTraceId,
  elapsedMs,
  latencyStart,
  recordServerLatency,
  recordSloObservation
} from '@/lib/performance/server-latency'

async function getGlobalLocationsByIds(ids, options = {}) {
  const search = await import('./global-location-search')
  return search.getGlobalLocationsByIds(ids, options)
}

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

function recordSupabaseQuery(name, started, traceId, failed = false) {
  recordServerLatency(`supabase.${name}`, elapsedMs(started), SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
    trace_id: traceId || null,
    service: 'supabase',
    operation: name,
    failed
  })
}

function validCursorTimestamp(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function validUuid(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null
}

async function queryFeedPosts(session, beforeCreatedAt, beforePostId, limit, traceId) {
  const started = latencyStart()
  const cursorAt = validCursorTimestamp(beforeCreatedAt)
  const cursorId = validUuid(beforePostId)
  let request = session.supabase
    .from('social_posts')
    .select('id,author_id,location_id,title,body,visibility,created_at,profiles!social_posts_author_id_fkey(display_name,username,avatar_path)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cursorAt && cursorId) {
    request = request.or(`created_at.lt.${cursorAt},and(created_at.eq.${cursorAt},id.lt.${cursorId})`)
  } else if (cursorAt) {
    request = request.lt('created_at', cursorAt)
  }

  try {
    const { data, error } = await request
    recordSupabaseQuery('social_feed_posts', started, traceId, Boolean(error))
    return error ? [] : data || []
  } catch {
    recordSupabaseQuery('social_feed_posts', started, traceId, true)
    return []
  }
}

function normalizeRpcComment(comment) {
  return {
    id: comment.id,
    post_id: comment.post_id,
    author_id: comment.author_id,
    body: comment.body,
    created_at: comment.created_at,
    profiles: {
      display_name: comment.display_name,
      username: comment.username,
      avatar_path: comment.avatar_path
    }
  }
}

async function queryCommentPreviews(session, postIds, traceId) {
  if (!postIds.length) return []

  const rpcStarted = latencyStart()
  try {
    const { data, error } = await session.supabase.rpc('social_comment_previews_v2', {
      post_ids: postIds,
      per_post: 3
    })
    recordSupabaseQuery('social_comment_previews_v2', rpcStarted, traceId, Boolean(error))
    if (!error) return (data || []).map(normalizeRpcComment)
  } catch {
    recordSupabaseQuery('social_comment_previews_v2', rpcStarted, traceId, true)
  }
  return []
}

function mediaUrl(session, path) {
  const value = String(path || '').trim()
  if (!value) return null
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function socialLocation(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.category || row.kind || 'place',
    summary: row.summary || row.description || null,
    city: row.city || null,
    neighborhood: row.neighborhood || null,
    status: row.status || 'published',
    cover_path: null,
    cover_url: openPhotoUrlForHash(row.primary_photo?.content_hash)
  }
}

async function hydrateLocations(session, ids) {
  if (!ids.length) return new Map()
  try {
    let rows = await cachedSocialLocations(JSON.stringify([...new Set(ids.map(String))].sort()))
    rows = await filterModeratedLocationRows(session.supabase, rows)
    return new Map(rows.map((row) => [String(row.id), socialLocation(row)]))
  } catch {
    return new Map()
  }
}

const DEFAULT_PAGE_SIZE = 3
const MAX_PAGE_SIZE = 40
const socialFeedInFlight = new Map()
const cachedSocialLocations = unstable_cache(
  async (serializedIds) => getGlobalLocationsByIds(JSON.parse(serializedIds), { traceId: null }),
  ['social-feed-location-hydration-v1'],
  { revalidate: 300, tags: ['social-feed-locations'] }
)

async function loadSocialFeedSnapshot(session, query = '', options = {}) {
  const traceId = session.traceId || createTraceId()
  const started = latencyStart()
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const pageSize = Math.max(1, Math.min(Number(options.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const beforeCreatedAt = String(options.beforeCreatedAt || '').trim() || null
  const beforePostId = String(options.beforePostId || '').trim() || null

  const postRows = await queryFeedPosts(session, beforeCreatedAt, beforePostId, pageSize + 1, traceId)
  const hasMore = postRows.length > pageSize
  const posts = postRows.slice(0, pageSize)
  const postIdsInOrder = posts.map((row) => row.id).filter(Boolean)
  const allLocationIds = [...new Set(posts.map((post) => post.location_id).filter(Boolean))]

  // Catalogue hydration, comment previews, and the current user's saved states
  // are independent once the bounded post page is known. Start all three reads
  // together instead of serializing B2 ahead of Supabase.
  const [locationsById, commentRows, states] = await Promise.all([
    hydrateLocations(session, allLocationIds),
    queryCommentPreviews(session, postIdsInOrder, traceId),
    allLocationIds.length ? queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,state,pinned_at')
        .eq('profile_id', session.user.id)
        .in('location_id', allLocationIds)
        .eq('state', 'saved')
        .limit(MAX_PAGE_SIZE)
    ) : []
  ])

  const visiblePosts = posts.map((post) => ({
    ...post,
    location: locationsById.get(String(post.location_id)) || null
  })).filter((post) => {
    const location = post.location
    if (!location || location.status !== 'published') return false
    if (!normalizedQuery) return true
    return `${post.title || ''} ${post.body || ''} ${location.name || ''} ${location.city || ''} ${location.kind || ''}`.toLowerCase().includes(normalizedQuery)
  })

  const saved = new Set(states.map((row) => row.location_id))
  const commentsByPost = new Map()
  for (const comment of commentRows) {
    const list = commentsByPost.get(comment.post_id) || []
    if (list.length < 3) {
      const author = comment.profiles || null
      list.push({
        id: comment.id,
        post_id: comment.post_id,
        author_id: comment.author_id,
        body: comment.body,
        created_at: comment.created_at,
        author,
        avatar_url: mediaUrl(session, author?.avatar_path)
      })
    }
    commentsByPost.set(comment.post_id, list)
  }

  const items = visiblePosts.map((post) => {
    const location = post.location
    const photoUrls = unique([location.cover_url]).slice(0, 1)
    return {
      ...post,
      author: post.profiles || null,
      author_avatar_url: mediaUrl(session, post.profiles?.avatar_path),
      location,
      photo_urls: photoUrls,
      saved: saved.has(post.location_id),
      comments: commentsByPost.get(post.id) || []
    }
  })

  const lastKey = posts[posts.length - 1] || null
  const durationMs = elapsedMs(started)
  recordSloObservation('socialFeed', durationMs, true, {
    trace_id: traceId,
    service: 'vercel',
    page_size: pageSize,
    returned: items.length,
    has_more: hasMore
  })

  return {
    items,
    // Friends are intentionally loaded only when the share menu is opened.
    friends: [],
    pagination: {
      hasMore,
      nextBeforeCreatedAt: hasMore ? lastKey?.created_at || null : null,
      nextBeforePostId: hasMore ? lastKey?.id || null : null,
      pageSize
    },
    self: {
      id: session.user.id,
      display_name: session.profile?.display_name || 'You',
      username: session.profile?.username || null,
      avatar_url: mediaUrl(session, session.profile?.avatar_path)
    }
  }
}

export async function getSocialFeedSnapshot(session, query = '', options = {}) {
  const key = JSON.stringify([
    String(session?.user?.id || ''),
    String(query || '').trim().toLowerCase(),
    String(options.beforeCreatedAt || ''),
    String(options.beforePostId || ''),
    Math.max(1, Math.min(Number(options.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  ])
  const active = socialFeedInFlight.get(key)
  if (active) return active
  const promise = loadSocialFeedSnapshot(session, query, options)
  socialFeedInFlight.set(key, promise)
  try {
    return await promise
  } finally {
    if (socialFeedInFlight.get(key) === promise) socialFeedInFlight.delete(key)
  }
}
