"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { objectFromFormData } from '@/lib/app/content-input'
import { LocationDraftError, saveLocationSubmission } from '@/lib/app/location-draft-write'
import { ensureGlobalLocationReferences } from '@/lib/app/global-location-reference'
import { createAdminClient } from '@/lib/supabase/admin'

function firstError(error, fallback) {
  const message = String(error?.message || '').trim()
  return !message || /policy|permission|schema cache|relation|supabase/i.test(message) ? fallback : message
}

function editLocationPath(id) {
  return id ? `/studio/places/${id}` : '/create/place'
}

async function persistLocation(formData) {
  const session = await requireUser({ onboarding: true })
  const input = objectFromFormData(formData)
  const id = String(input.id || '').trim()
  try {
    const location = await saveLocationSubmission(session.supabase, session.user.id, input)
    return { session, location }
  } catch (error) {
    if (!(error instanceof LocationDraftError)) {
      redirect(pathWithMessage(editLocationPath(id), 'error', 'We could not save this location draft.'))
    }
    const destination = error.code === 'pass_required' ? '/membership'
      : error.code === 'not_found' ? '/create/place'
        : editLocationPath(error.locationId || id)
    redirect(pathWithMessage(destination, 'error', error.message))
  }
}

export async function saveLocationDraft(formData) {
  const { location } = await persistLocation(formData)
  revalidatePath('/create')
  redirect(pathWithMessage(`/studio/places/${location.id}`, 'success', 'Location draft saved.'))
}

export async function requestLocationPublication(formData) {
  const { session, location } = await persistLocation(formData)
  const { data, error } = await session.supabase.rpc('request_location_publication', { target: location.id })
  if (error) {
    redirect(pathWithMessage(`/studio/places/${location.id}`, 'error', firstError(error, 'This location is not ready to publish yet.')))
  }
  revalidatePath(`/studio/places/${location.id}`)
  redirect(pathWithMessage(`/studio/places/${location.id}`, 'success', data === 'published' ? 'Location approved for the canonical location pipeline.' : 'Location submitted for review.'))
}

export async function transitionLocationStatus(formData) {
  const session = await requireUser({ onboarding: true })
  const id = String(formData.get('id') || '')
  const nextStatus = String(formData.get('next_status') || '')
  const note = String(formData.get('note') || '').slice(0, 500)
  const { error } = await session.supabase.rpc('transition_location_status', {
    target: id,
    next_status: nextStatus,
    transition_note: note || null
  })
  if (error) {
    redirect(pathWithMessage(`/studio/places/${id}`, 'error', firstError(error, 'That location status change is not allowed.')))
  }
  revalidatePath(`/studio/places/${id}`)
  redirect(pathWithMessage(`/studio/places/${id}`, 'success', `Location moved to ${nextStatus.replaceAll('_', ' ')}.`))
}

export async function submitLocationClaim(formData) {
  const session = await requireUser({ onboarding: true })
  const locationId = String(formData.get('location_id') || '')
  const hostProfileId = String(formData.get('host_profile_id') || '').trim() || null
  const relationship = String(formData.get('relationship') || '').trim().slice(0, 120)
  const evidenceUrl = String(formData.get('evidence_url') || '').trim().slice(0, 500) || null
  const note = String(formData.get('note') || '').trim().slice(0, 1200) || null
  const next = safeNextPath(String(formData.get('next') || '/discover'))
  if (!locationId || !relationship) {
    redirect(pathWithMessage(next, 'error', 'Describe your relationship to this location.'))
  }

  try {
    await ensureGlobalLocationReferences(createAdminClient(), [locationId])
  } catch {
    redirect(pathWithMessage(next, 'error', 'That location is not available in the canonical catalogue.'))
  }

  const { error } = await session.supabase.from('location_claims').insert({
    location_id: locationId,
    claimant_id: session.user.id,
    host_profile_id: hostProfileId,
    relationship,
    evidence_url: evidenceUrl,
    note
  })
  if (error) redirect(pathWithMessage(next, 'error', firstError(error, 'We could not submit this claim.')))
  redirect(pathWithMessage(next, 'success', 'Location claim submitted for review.'))
}
