"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function value(formData, key, max = 1000) {
  return String(formData.get(key) || '').trim().slice(0, max)
}

function back(message, type = 'success') {
  redirect(pathWithMessage('/map', type, message))
}

export async function createFeedComment(_previousState, formData) {
  const session = await requireUser({ onboarding: true })
  const postId = value(formData, 'post_id', 80)
  const body = value(formData, 'comment_body', 2000)
  if (!postId || !body) return { error: 'Add a comment before posting.' }
  try {
    const { data, error } = await session.supabase.rpc('create_social_comment_v1', {
      target_kind: 'post',
      target_id: postId,
      comment_body: body,
      parent_comment: null
    })
    if (error || data == null) return { error: 'We could not add that comment.' }
    revalidatePath('/map')
    return { comment: { id: data, body, author: { display_name: session.profile?.display_name || 'Puddle person', username: session.profile?.username || null } } }
  } catch {
    return { error: 'We could not add that comment.' }
  }
}

export async function toggleFeedSave(_previousState, formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  if (!locationId) return { error: 'That place is unavailable.' }

  try {
    const { data: existing, error } = await session.supabase
      .from('user_content_states')
      .select('location_id')
      .eq('profile_id', session.user.id)
      .eq('location_id', locationId)
      .eq('state', 'saved')
      .maybeSingle()
    if (error) return { error: 'We could not update your saved places.' }

    const result = existing
      ? await session.supabase.from('user_content_states').delete().eq('profile_id', session.user.id).eq('location_id', locationId).eq('state', 'saved')
      : await session.supabase.from('user_content_states').insert({ profile_id: session.user.id, location_id: locationId, state: 'saved' })

    if (result.error) return { error: 'We could not update your saved places.' }
    revalidatePath('/map')
    revalidatePath('/plans')
    revalidatePath('/profile')
    return { saved: !existing }
  } catch {
    return { error: 'We could not update your saved places.' }
  }
}

export async function shareFeedPost(formData) {
  const session = await requireUser({ onboarding: true })
  const postId = value(formData, 'post_id', 80)
  const friendId = value(formData, 'friend_id', 80)
  const requestKey = value(formData, 'share_key', 80) || randomUUID()
  if (!postId || !friendId) back('Choose a friend to share with.', 'error')
  if (!UUID_PATTERN.test(requestKey)) back('That share request is invalid. Try again.', 'error')
  const { error } = await session.supabase.rpc('share_content_v1', {
    target_kind: 'post',
    target_id: postId,
    recipient_profile: friendId,
    target_plan: null,
    share_note: null,
    request_key: requestKey
  })
  if (error) back('We could not share that puddle.', 'error')
  revalidatePath('/matches')
  back('Shared with your friend.')
}
