import { providerPhotoPath } from './place-photos'

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
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

export async function getSocialFeedSnapshot(session, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  const posts = await queryOr(
    session.supabase
      .from('social_posts')
      .select('id,author_id,location_id,title,body,visibility,created_at,profiles!social_posts_author_id_fkey(display_name,username,avatar_path),locations!social_posts_location_id_fkey(id,name,slug,kind,city,neighborhood,cover_path,status)')
      .order('created_at', { ascending: false })
      .limit(100)
  )

  const visiblePosts = posts.filter((post) => {
    const location = post.locations
    if (!location || location.status !== 'published') return false
    if (!normalizedQuery) return true
    return `${post.title || ''} ${post.body || ''} ${location.name || ''} ${location.city || ''} ${location.kind || ''}`.toLowerCase().includes(normalizedQuery)
  })

  const postIds = visiblePosts.map((post) => post.id)
  const locationIds = [...new Set(visiblePosts.map((post) => post.location_id).filter(Boolean))]
  const [comments, states, friends, photoRows] = await Promise.all([
    postIds.length ? queryOr(
      session.supabase
        .from('social_comments')
        .select('id,post_id,author_id,body,created_at,profiles!social_comments_author_id_fkey(display_name,username,avatar_path)')
        .in('post_id', postIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
    ) : [],
    locationIds.length ? queryOr(
      session.supabase
        .from('user_content_states')
        .select('location_id,state,pinned_at')
        .eq('profile_id', session.user.id)
        .in('location_id', locationIds)
        .eq('state', 'saved')
    ) : [],
    queryOr(session.supabase.rpc('social_friends_v1')),
    locationIds.length ? queryOr(
      session.supabase
        .from('location_photo_sources')
        .select('id,location_id,is_primary,sort_order,verified_at')
        .in('location_id', locationIds)
        .eq('status', 'approved')
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(500)
    ) : []
  ])

  const saved = new Set(states.map((row) => row.location_id))
  const commentsByPost = new Map()
  for (const comment of comments) {
    const list = commentsByPost.get(comment.post_id) || []
    list.push({
      ...comment,
      author: comment.profiles || null,
      avatar_url: mediaUrl(session, comment.profiles?.avatar_path)
    })
    commentsByPost.set(comment.post_id, list)
  }

  const photosByLocation = new Map()
  for (const row of photoRows) {
    const list = photosByLocation.get(row.location_id) || []
    list.push(providerPhotoPath(row.id))
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

  return {
    items,
    friends,
    self: {
      id: session.user.id,
      display_name: session.profile?.display_name || 'You',
      username: session.profile?.username || null,
      avatar_url: mediaUrl(session, session.profile?.avatar_path)
    }
  }
}
