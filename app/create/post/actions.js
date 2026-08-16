"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

function text(formData, key, max) {
  return String(formData.get(key) || '').trim().slice(0, max)
}

export async function createPuddlePost(formData) {
  const session = await requireUser({ onboarding: true })
  const title = text(formData, 'title', 80)
  const body = text(formData, 'description', 1000)
  const locationId = text(formData, 'location_id', 80)
  const visibility = text(formData, 'visibility', 20) === 'friends' ? 'friends' : 'public'

  if (!title) redirect(pathWithMessage('/create/post', 'error', 'Add a title before publishing.'))
  if (!locationId) redirect(pathWithMessage('/create/post', 'error', 'Choose a saved place for this puddle.'))

  const { data: location } = await session.supabase
    .from('locations')
    .select('id,status,visibility')
    .eq('id', locationId)
    .maybeSingle()
  if (!location || location.status !== 'published' || location.visibility !== 'public') {
    redirect(pathWithMessage('/create/post', 'error', 'That place is not available to post.'))
  }

  const { error } = await session.supabase.from('social_posts').insert({
    author_id: session.user.id,
    location_id: locationId,
    title,
    body,
    visibility
  })
  if (error) redirect(pathWithMessage(`/create/post?location=${encodeURIComponent(locationId)}`, 'error', 'We could not publish that puddle. Please try again.'))

  revalidatePath('/map')
  revalidatePath('/profile')
  redirect(pathWithMessage('/map', 'success', 'Puddle published.'))
}
