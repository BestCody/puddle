"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

function value(formData, name, max = 2000) {
  return String(formData.get(name) || '').trim().slice(0, max)
}

function fullValue(formData, name) {
  return String(formData.get(name) || '').trim()
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
  const rawPlannedFor = value(formData, 'planned_for', 80)
  const plannedFor = optionalDate(rawPlannedFor)
  const note = fullValue(formData, 'note')

  if (note.length > 500) redirect(pathWithMessage('/plans', 'error', 'Keep visit notes to 500 characters or fewer.'))
  if (status === 'planned' && rawPlannedFor && !plannedFor) redirect(pathWithMessage('/plans', 'error', 'Choose a valid planned date and time.'))

  const { error } = await session.supabase.from('location_visits').upsert({
    profile_id: session.user.id,
    location_id: locationId,
    status,
    planned_for: status === 'planned' ? plannedFor : null,
    visited_at: status === 'visited' ? new Date().toISOString() : null,
    note: note || null,
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
