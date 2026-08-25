import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { getGlobalLocationsByIds } from './global-location-search'
import { filterModeratedLocationRows } from './location-moderation-overlay'
import {
  SERVER_LATENCY_BUDGET_MS,
  createTraceId,
  elapsedMs,
  latencyStart,
  recordServerLatency,
  recordSloObservation
} from '@/lib/performance/server-latency'

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

async function queryFeedKeys(session, beforeCreatedAt, beforePostId, limit, traceId) {
  const started = latencyStart()
  const cursorAt = validCursorTimestamp(beforeCreatedAt)
  const cursorId = validUuid(beforePostId)
  let request = session.supabase
    .from('social_posts')
    .select('id,created_at')
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
    recordSupabaseQuery('social_feed_post_keys', started, traceId, Boolean(error))
    return error ? [] : data || []
  } catch {
    recordSupabaseQuery('social_feed_post_keys', started, traceId, true)
    return []
  }
}

async function queryCommentPreviews(session, postIds, traceId) {
  if (!postIds.length) return []
  const started = latencyStart()
  const limit = Math.min(Math.max(postIds.length * 6, 18), 150)
  try {
    const { data, error } = await session.supabase
      .from('social_comments')
      .select('id,post_id,author_id,body,created_at,profiles!social_comments_author_id_fkey(display_name,username,avatar_path)')
      .in('post_id', postIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    recordSupabaseQuery('social_comment_previews', started, traceId, Boolean(error))
    return error ? [] : data || []
  } catch {
    recordSupabaseQuery('social_comment_previews', started, traceId, true)
    return []
  }
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

async function hydrateLocations(session, ids, traceId) {
  if (!ids.length) return new Map()
  try {
    let rows = await getGlobalLocationsByIds(ids, { traceId })
    rows = await filterModeratedLocationRows(session.supabase, rows)
    return new Map(rows.map((row) => [String(row.id), socialLocation(row)]))
  } catch {
    return new Map()
  }
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 40

export async function getSocialFeedSnapshot(session, query = '', options = {}) {
  const traceId = session.traceId || createTraceId()
  const started = latencyStart()
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const pageSize = Math.max(1, Math.min(Number(options.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const beforeCreatedAt = String(options.beforeCreatedAt || '').trim() || null
  const beforePostId = String(options.beforePostId || '').trim() || null

  const keyRows = await queryFeedKeys(session, beforeCreatedAt, beforePostId, pageSize + 1, traceId)
  const hasMore = keyRows.length > pageSize
  const pageKeys = keyRows.slice(0, pageSize)
  const postIdsInOrder = pageKeys.map((row) => row.id).filter(Boolean)

  const hydrated = postIdsInOrder.length ? await queryOr(
    session.supabase
      .from('social_posts')
      .select('id,author_id,location_id,title,body,visibility,created_at,profiles!social_posts_author_id_fkey(display_name,username,avatar_path)')
      .in('id', postIdsInOrder)
      .limit(MAX_PAGE_SIZE)
  ) : []
  const byId = new Map(hydrated.map((post) => [post.id, post]))
  const posts = postIdsInOrder.map((id) => byId.get(id)).filter(Boolean)
  const allLocationIds = [...new Set(posts.map((post) => post.location_id).filter(Boolean))]
  const locationsById = await hydrateLocations(session, allLocationIds, traceId)

  const visiblePosts = posts.map((post) => ({
    ...post,
    location: locationsById.get(String(post.location_id)) || null
  })).filter((post) => {
    const location = post.location
    if (!location || location.status !== 'published') return false
    if (!normalizedQuery) return true
    return `${post.title || ''} ${post.body || ''} ${location.name || ''} ${location.city || ''} ${location.kind || ''}`.toLowerCase().includes(normalizedQuery)
  })

  const visiblePostIds = visiblePosts.map((post) => post.id)
  const locationIds = [...new Set(visiblePosts.map((post) => post.location_id).filter(Boolean))]
  const [commentRows, states] = await Promise.all([
    queryCommentPreviews(session, visiblePostIds, traceId),
    locationIds.length ? queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,state,pinned_at')
        .eq('profile_id', session.user.id)
        .in('location_id', locationIds)
        .eq('state', 'saved')
        .limit(MAX_PAGE_SIZE)
    ) : []
  ])

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

  const lastKey = pageKeys[pageKeys.length - 1] || null
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
