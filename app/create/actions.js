"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { locationPayload, objectFromFormData, validateLocation } from '@/lib/app/content-input'

function firstError(error, fallback) {
  const message = String(error?.message || '').trim()
  return !message || /policy|permission|schema cache|relation|supabase/i.test(message) ? fallback : message
}

function editLocationPath(id) {
  return id ? `/studio/places/${id}` : '/create/place'
}

async function savePrivateDetail(supabase, id, exactAddress, userId) {
  if (exactAddress) {
    const { error } = await supabase.from('location_private_details').upsert({
      location_id: id,
      exact_address: exactAddress,
      updated_by: userId,
      updated_at: new Date().toISOString()
    })
    return error
  }
  const { error } = await supabase.from('location_private_details').delete().eq('location_id', id)
  return error
}

async function persistLocation(formData) {
  const session = await requireUser({ onboarding: true })
  const input = objectFromFormData(formData)
  const id = String(input.id || '').trim()
  let existing = null

  if (!id) {
    const { data: passActive, error: passError } = await session.supabase.rpc('puddle_tinder_active_v1')
    if (passError || !passActive) {
      redirect(pathWithMessage('/membership', 'error', 'Puddle Pass is required to create a location.'))
    }
  }

  if (id) {
    const { data } = await session.supabase.from('locations').select('*').eq('id', id).maybeSingle()
    existing = data
    if (!existing) redirect(pathWithMessage('/create/place', 'error', 'That location draft is not available.'))
  }

  const payload = locationPayload(input, session.user.id, existing)
  const errors = validateLocation(payload)
  if (errors.length) redirect(pathWithMessage(editLocationPath(id), 'error', errors[0]))

  const privateAddress = payload.private_address
  const writable = { ...payload }
  delete writable.private_address
  if (existing) {
    delete writable.created_by
    delete writable.slug
  }

  const query = existing
    ? session.supabase.from('locations').update(writable).eq('id', id).select('id,slug,status').single()
    : session.supabase.from('locations').insert(writable).select('id,slug,status').single()
  const { data, error } = await query
  if (error || !data) {
    redirect(pathWithMessage(editLocationPath(id), 'error', firstError(error, 'We could not save this location draft.')))
  }

  const privateError = await savePrivateDetail(session.supabase, data.id, privateAddress, session.user.id)
  if (privateError) {
    redirect(pathWithMessage(`/studio/places/${data.id}`, 'error', 'The draft saved, but its private address could not be secured.'))
  }
  return { session, location: data }
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
  revalidatePath('/discover')
  revalidatePath(`/places/${location.slug}`)
  redirect(pathWithMessage(`/studio/places/${location.id}`, 'success', data === 'published' ? 'Location published.' : 'Location submitted for review.'))
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
