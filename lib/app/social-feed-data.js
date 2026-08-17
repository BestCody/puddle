import { providerPhotoPath } from './place-photos'

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

async function rpcOr(session, name, args = {}, fallback = []) {
  try {
    const { data, error } = await session.supabase.rpc(name, args)
    return error ? fallback : data || fallback
  } catch {
    return fallback
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

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 40

export async function getSocialFeedSnapshot(session, query = '', options = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const pageSize = Math.max(1, Math.min(Number(options.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const beforeCreatedAt = String(options.beforeCreatedAt || '').trim() || null

  let postQuery = session.supabase
    .from('social_posts')
    .select('id,author_id,location_id,title,body,visibility,created_at,profiles!social_posts_author_id_fkey(display_name,username,avatar_path),locations!social_posts_location_id_fkey(id,name,slug,kind,city,neighborhood,cover_path,status)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1)
  if (beforeCreatedAt) postQuery = postQuery.lt('created_at', beforeCreatedAt)

  const page = await queryOr(postQuery)
  const hasMore = page.length > pageSize
  const posts = page.slice(0, pageSize)
  const visiblePosts = posts.filter((post) => {
    const location = post.locations
    if (!location || location.status !== 'published') return false
    if (!normalizedQuery) return true
    return `${post.title || ''} ${post.body || ''} ${location.name || ''} ${location.city || ''} ${location.kind || ''}`.toLowerCase().includes(normalizedQuery)
  })

  const postIds = visiblePosts.map((post) => post.id)
  const locationIds = [...new Set(visiblePosts.map((post) => post.location_id).filter(Boolean))]
  const photoLimit = Math.max(5, Math.min(250, locationIds.length * 5))
  const [commentRows, states, photoRows] = await Promise.all([
    postIds.length ? rpcOr(session, 'social_comment_previews_v2', { post_ids: postIds, per_post: 3 }) : [],
    locationIds.length ? queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,state,pinned_at')
        .eq('profile_id', session.user.id)
        .in('location_id', locationIds)
        .eq('state', 'saved')
    ) : [],
    locationIds.length ? queryOr(
      session.supabase
        .from('location_photo_sources')
        .select('id,location_id,is_primary,sort_order,verified_at')
        .in('location_id', locationIds)
        .eq('status', 'approved')
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(photoLimit)
    ) : []
  ])

  const saved = new Set(states.map((row) => row.location_id))
  const commentsByPost = new Map()
  for (const comment of commentRows) {
    const list = commentsByPost.get(comment.post_id) || []
    list.push({
      id: comment.id,
      post_id: comment.post_id,
      author_id: comment.author_id,
      body: comment.body,
      created_at: comment.created_at,
      author: {
        display_name: comment.display_name,
        username: comment.username,
        avatar_path: comment.avatar_path
      },
      avatar_url: mediaUrl(session, comment.avatar_path)
    })
    commentsByPost.set(comment.post_id, list)
  }

  const photosByLocation = new Map()
  for (const row of photoRows) {
    const list = photosByLocation.get(row.location_id) || []
    if (list.length < 5) list.push(providerPhotoPath(row.id))
    photosByLocation.set(row.location_id, list)
  }

  const items = visiblePosts.map((post) => {
    const location = post.locations
    const cover = mediaUrl(session, location.cover_path)
    const photoUrls = unique([cover, ...(photosByLocation.get(post.location_id) || [])]).slice(0, 5)
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

  const lastPost = posts[posts.length - 1] || null
  return {
    items,
    // Friend hydration was removed from the feed hot path. Friend selectors should
    // use social_friends_v2 independently when/if the UI opens one.
    friends: [],
    pagination: {
      hasMore,
      nextBeforeCreatedAt: hasMore ? lastPost?.created_at || null : null,
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
