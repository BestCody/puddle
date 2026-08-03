"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

function value(formData, name, max = 2000) {
  return String(formData.get(name) || '').trim().slice(0, max)
}

function optionalDate(input) {
  if (!input) return null
  const parsed = new Date(input)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export async function recordLocationVisit(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = value(formData, 'location_id', 64)
  const status = value(formData, 'status', 20) === 'visited' ? 'visited' : 'planned'
  const plannedFor = optionalDate(value(formData, 'planned_for', 80))
  const { error } = await session.supabase.from('location_visits').upsert({
    profile_id: session.user.id,
    location_id: locationId,
    status,
    planned_for: status === 'planned' ? plannedFor : null,
    visited_at: status === 'visited' ? new Date().toISOString() : null,
    note: value(formData, 'note', 500) || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'profile_id,location_id' })
  if (error) redirect(pathWithMessage('/plans', 'error', 'The place visit could not be saved.'))
  revalidatePath('/plans')
  redirect(pathWithMessage(
    status === 'visited' ? '/plans?tab=past' : '/plans?tab=planned',
    'success',
    status === 'visited' ? 'Visit recorded.' : 'Place added to your visit plans.'
  ))
}
