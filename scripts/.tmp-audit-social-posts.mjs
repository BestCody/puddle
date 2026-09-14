import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Production Supabase credentials are required.')

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { count, error: countError } = await admin.from('social_posts').select('id', { count: 'exact', head: true })
if (countError) throw countError

const { data: posts, error: postError } = await admin
  .from('social_posts')
  .select('id,author_id,location_id,title,body,visibility,created_at,updated_at')
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(1000)
if (postError) throw postError

const authorIds = [...new Set((posts || []).map((post) => post.author_id).filter(Boolean))]
const [{ data: profiles, error: profileError }] = await Promise.all([
  authorIds.length ? admin.from('profiles').select('id,display_name,username,moderation_state,suspended_at,banned_at').in('id', authorIds) : { data: [], error: null },
])
if (profileError) throw profileError

const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]))
const result = (posts || []).map((post) => ({
  ...post,
  author: profileById.get(post.author_id) || null
}))
console.log(JSON.stringify({ count, returned: result.length, posts: result }, null, 2))
