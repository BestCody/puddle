"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureGlobalLocationReferences } from '@/lib/app/global-location-reference'
import { enforceRateLimitFromHeaders } from '@/lib/security/rate-limit'

function text(formData, key, max) {
  return String(formData.get(key) || '').trim().slice(0, max)
}

function feedMessage(kind, message, extra = {}) {
  return pathWithMessage('/map', kind, message, { compose: '1', ...extra })
}

export async function createPuddlePost(formData) {
  const session = await requireUser({ onboarding: true })
  const title = text(formData, 'title', 80)
  const body = text(formData, 'description', 1000)
  const locationId = text(formData, 'location_id', 80)
  const visibility = text(formData, 'visibility', 20) === 'friends' ? 'friends' : 'public'

  if (!title) redirect(feedMessage('error', 'Add a title before publishing.'))
  if (!locationId) redirect(feedMessage('error', 'Choose a saved place for this puddle.'))

  const limited = await enforceRateLimitFromHeaders({
    headers: await headers(), userId: session.user.id, action: 'create_puddle_post'
  })
  if (!limited.allowed) redirect(feedMessage('error', 'Too many puddles were published. Try again later.'))

  try {
    await ensureGlobalLocationReferences(createAdminClient(), [locationId])
  } catch {
    redirect(feedMessage('error', 'That place is not available to post.', { location: locationId }))
  }

  const { error } = await session.supabase.from('social_posts').insert({
    author_id: session.user.id,
    location_id: locationId,
    title,
    body,
    visibility
  })
  if (error) redirect(feedMessage('error', 'We could not publish that puddle. Please try again.', { location: locationId }))

  revalidatePath('/map')
  revalidatePath('/profile')
  redirect(pathWithMessage('/map', 'success', 'Puddle published.'))
}
