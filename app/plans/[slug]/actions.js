"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

function value(formData, key, max = 1000) {
  return String(formData.get(key) || '').trim().slice(0, max)
}

function destination(formData) {
  const slug = value(formData, 'slug', 180)
  return slug ? `/plans/${encodeURIComponent(slug)}` : '/plans'
}

function finish(formData, message, type = 'success') {
  redirect(pathWithMessage(destination(formData), type, message))
}

async function savedState(session, locationId) {
  const { data } = await session.supabase
    .from('user_content_states')
    .select('location_id,pinned_at')
    .eq('profile_id', session.user.id)
    .eq('location_id', locationId)
    .eq('state', 'saved')
    .maybeSingle()
  return data || null
}

export async function toggleSavedPlace(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  const existing = await savedState(session, locationId)
  if (!locationId) finish(formData, 'That place is unavailable.', 'error')

  const result = existing
    ? await session.supabase.from('user_content_states').delete().eq('profile_id', session.user.id).eq('location_id', locationId).eq('state', 'saved')
    : await session.supabase.from('user_content_states').insert({ profile_id: session.user.id, location_id: locationId, state: 'saved' })
  if (result.error) finish(formData, 'We could not update your saved places.', 'error')

  revalidatePath('/plans')
  revalidatePath('/map')
  revalidatePath('/profile')
  finish(formData, existing ? 'Removed from Saved.' : 'Saved to Puddle.')
}

export async function togglePinnedPlace(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  if (!locationId) finish(formData, 'That place is unavailable.', 'error')
  const existing = await savedState(session, locationId)
  const pinnedAt = existing?.pinned_at ? null : new Date().toISOString()
  const result = existing
    ? await session.supabase.from('user_content_states').update({ pinned_at: pinnedAt }).eq('profile_id', session.user.id).eq('location_id', locationId).eq('state', 'saved')
    : await session.supabase.from('user_content_states').insert({ profile_id: session.user.id, location_id: locationId, state: 'saved', pinned_at: pinnedAt })
  if (result.error) finish(formData, 'We could not update that pin.', 'error')

  revalidatePath('/plans')
  revalidatePath('/profile')
  finish(formData, pinnedAt ? 'Pinned to the top of Saved.' : 'Unpinned.')
}

export async function planPlaceVisit(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  const plannedForInput = value(formData, 'planned_for', 80)
  const note = value(formData, 'note', 500)
  const plannedFor = new Date(plannedForInput)
  if (!locationId || !plannedForInput || Number.isNaN(plannedFor.getTime()) || plannedFor.getTime() <= Date.now()) {
    finish(formData, 'Choose a future date and time.', 'error')
  }

  const { error } = await session.supabase.from('location_visits').upsert({
    profile_id: session.user.id,
    location_id: locationId,
    status: 'planned',
    planned_for: plannedFor.toISOString(),
    visited_at: null,
    note: note || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'profile_id,location_id' })
  if (error) finish(formData, 'We could not plan that visit.', 'error')

  revalidatePath('/plans')
  revalidatePath('/map')
  finish(formData, 'Visit added to Plans.')
}

export async function shareSavedPlace(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  const friendId = value(formData, 'friend_id', 80)
  if (!locationId || !friendId) finish(formData, 'Choose a friend to share with.', 'error')
  const { error } = await session.supabase.rpc('share_content_v1', {
    target_kind: 'place',
    target_id: locationId,
    recipient_profile: friendId,
    target_plan: null,
    share_note: null
  })
  if (error) finish(formData, 'We could not share that place.', 'error')
  revalidatePath('/matches')
  finish(formData, 'Place shared.')
}

export async function upsertPlaceReview(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  const rating = Number(value(formData, 'rating', 1))
  const body = value(formData, 'body', 2000)
  if (!locationId) finish(formData, 'That place is unavailable.', 'error')
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) finish(formData, 'Choose a rating from 1 to 5.', 'error')

  const { error } = await session.supabase.rpc('upsert_location_review_v1', {
    target_location: locationId,
    review_rating: rating,
    review_body: body
  })
  if (error) finish(formData, 'We could not save your review.', 'error')

  revalidatePath(destination(formData))
  finish(formData, 'Your review was saved.')
}

export async function deletePlaceReview(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 80)
  if (!locationId) finish(formData, 'That place is unavailable.', 'error')

  const { data, error } = await session.supabase.rpc('delete_location_review_v1', { target_location: locationId })
  if (error || !data) finish(formData, 'We could not remove your review.', 'error')

  revalidatePath(destination(formData))
  finish(formData, 'Your review was removed.')
}
