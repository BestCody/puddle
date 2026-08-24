import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getPublicLocation } from '@/lib/app/public-content'
import { ensureGlobalLocationReferences } from '@/lib/app/global-location-reference'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCsrf } from '@/lib/security/csrf'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function mediaUrl(supabase, path) {
  const value = String(path || '').trim()
  if (!value) return null
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

async function requireApiUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function detailPayload(supabase, user, slug) {
  const result = await getPublicLocation(slug)
  if (!result?.location) return null
  const { location, similar = [] } = result

  const [savedResult, friendsResult, visitResult, postsResult] = await Promise.all([
    supabase
      .from('user_content_states')
      .select('location_id,pinned_at')
      .eq('profile_id', user.id)
      .eq('location_id', location.id)
      .eq('state', 'saved')
      .maybeSingle(),
    supabase.rpc('social_friends_v2'),
    supabase
      .from('location_visits')
      .select('planned_for,note,status')
      .eq('profile_id', user.id)
      .eq('location_id', location.id)
      .eq('status', 'planned')
      .maybeSingle(),
    supabase
      .from('social_posts')
      .select('id,author_id,location_id,title,body,visibility,created_at,profiles!social_posts_author_id_fkey(display_name,username,avatar_path)')
      .eq('location_id', location.id)
      .order('created_at', { ascending: false })
      .limit(12)
  ])

  const posts = (postsResult.data || []).map((post) => ({
    id: post.id,
    title: post.title,
    body: post.body,
    created_at: post.created_at,
    author: post.profiles ? {
      display_name: post.profiles.display_name,
      username: post.profiles.username
    } : null,
    author_avatar_url: mediaUrl(supabase, post.profiles?.avatar_path)
  }))

  return {
    location,
    similar: similar.slice(0, 3),
    state: {
      saved: Boolean(savedResult.data),
      pinned: Boolean(savedResult.data?.pinned_at),
      planned: visitResult.data || null
    },
    friends: friendsResult.data || [],
    posts
  }
}

async function ensureLocationReference(locationId) {
  await ensureGlobalLocationReferences(createAdminClient(), [locationId])
}

function error(message, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_request, context) {
  const { slug } = await context.params
  const { supabase, user } = await requireApiUser()
  if (!user) return error('Sign in to view Saved details.', 401)

  try {
    const payload = await detailPayload(supabase, user, slug)
    if (!payload) return error('Saved location not found.', 404)
    return NextResponse.json(payload)
  } catch (cause) {
    return error(safeSecurityError(cause, 'Saved details could not be loaded.'), 500)
  }
}

export async function POST(request, context) {
  if (!verifyCsrf(request)) return error('Security token is invalid.', 403)
  const { slug } = await context.params
  const { supabase, user } = await requireApiUser()
  if (!user) return error('Sign in to update Saved locations.', 401)

  let input
  try {
    input = await readJsonLimited(request, 32_000)
  } catch (cause) {
    return error(safeSecurityError(cause, 'That request could not be read.'), cause?.status || 400)
  }

  const result = await getPublicLocation(slug)
  const location = result?.location
  if (!location) return error('Saved location not found.', 404)

  try {
    await ensureLocationReference(location.id)
    const action = clean(input.action, 40)

    if (action === 'toggle_saved') {
      const existing = await supabase
        .from('user_content_states')
        .select('location_id')
        .eq('profile_id', user.id)
        .eq('location_id', location.id)
        .eq('state', 'saved')
        .maybeSingle()
      const mutation = existing.data
        ? supabase.from('user_content_states').delete().eq('profile_id', user.id).eq('location_id', location.id).eq('state', 'saved')
        : supabase.from('user_content_states').insert({ profile_id: user.id, location_id: location.id, state: 'saved' })
      const { error: mutationError } = await mutation
      if (mutationError) return error('We could not update your saved places.')
      revalidatePath('/plans')
      revalidatePath('/profile')
      revalidatePath('/map')
    } else if (action === 'toggle_pinned') {
      const existing = await supabase
        .from('user_content_states')
        .select('location_id,pinned_at')
        .eq('profile_id', user.id)
        .eq('location_id', location.id)
        .eq('state', 'saved')
        .maybeSingle()
      const pinnedAt = existing.data?.pinned_at ? null : new Date().toISOString()
      const mutation = existing.data
        ? supabase.from('user_content_states').update({ pinned_at: pinnedAt }).eq('profile_id', user.id).eq('location_id', location.id).eq('state', 'saved')
        : supabase.from('user_content_states').insert({ profile_id: user.id, location_id: location.id, state: 'saved', pinned_at: pinnedAt })
      const { error: mutationError } = await mutation
      if (mutationError) return error('We could not update that pin.')
      revalidatePath('/plans')
      revalidatePath('/profile')
    } else if (action === 'plan') {
      const plannedFor = new Date(clean(input.planned_for, 80))
      if (Number.isNaN(plannedFor.getTime()) || plannedFor.getTime() <= Date.now()) return error('Choose a future date and time.')
      const { error: mutationError } = await supabase.from('location_visits').upsert({
        profile_id: user.id,
        location_id: location.id,
        status: 'planned',
        planned_for: plannedFor.toISOString(),
        visited_at: null,
        note: clean(input.note, 500) || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'profile_id,location_id' })
      if (mutationError) return error('We could not plan that visit.')
      revalidatePath('/plans')
      revalidatePath('/map')
    } else if (action === 'share') {
      const friendId = clean(input.friend_id, 80)
      if (!friendId) return error('Choose a friend to share with.')
      const { error: mutationError } = await supabase.rpc('share_content_v1', {
        target_kind: 'place',
        target_id: location.id,
        recipient_profile: friendId,
        target_plan: null,
        share_note: null
      })
      if (mutationError) return error('We could not share that place.')
      revalidatePath('/matches')
    } else {
      return error('Unknown Saved action.', 404)
    }

    const payload = await detailPayload(supabase, user, slug)
    return NextResponse.json({ ok: true, ...payload })
  } catch (cause) {
    return error(safeSecurityError(cause, 'That Saved action could not be completed.'), 500)
  }
}
