"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { ensureProfile } from '@/lib/auth/profile'
import { profileLocationFromForm } from '@/lib/app/profile-location'
import { birthDateError } from '@/lib/app/input-validation'
import { isDuplicateUsernameError, profileWriteErrorMessage } from '@/lib/auth/errors'
import { pathWithMessage } from '@/lib/auth/redirect'

const allowedDateLocations = new Set([
  'cafe',
  'restaurant',
  'bar',
  'park',
  'museum',
  'gallery',
  'attraction',
  'activity_venue',
  'scenic_spot',
  'nightlife',
  'shop',
  'community_space'
])
const allowedVisibility = new Set(['hidden', 'friends', 'mutuals', 'attendees', 'public'])

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

function failure(stateful, message, fieldErrors = {}) {
  if (stateful) return { message, fieldErrors, submittedAt: Date.now() }
  redirect(pathWithMessage('/onboarding', 'error', message))
}

async function preserveProgressWithoutUsername(supabase, payload, profile) {
  const retryPayload = { ...payload, username: profile?.username || null }
  delete retryPayload.onboarding_completed_at
  await supabase.from('profiles').upsert(retryPayload, { onConflict: 'id' })
}

export async function completeDateOnboarding(previousState, maybeFormData) {
  const stateful = maybeFormData !== undefined
  const formData = stateful ? maybeFormData : previousState

  if (!isSupabaseConfigured()) {
    return failure(stateful, 'Accounts are temporarily unavailable. Please try again later.', { form: 'Accounts are temporarily unavailable.' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/onboarding')

  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return failure(stateful, 'We could not load your profile. Refresh the page and try again.', { form: 'Profile unavailable.' })

  const displayName = value(formData, 'display_name') || profile?.display_name || user.user_metadata?.display_name || 'Puddle person'
  const username = value(formData, 'username').toLowerCase()
  const birthDate = value(formData, 'birth_date')
  const radiusValue = value(formData, 'search_radius_km')
  const radius = Number(radiusValue)
  const bio = value(formData, 'bio')
  const dateLocations = [...new Set(
    formData.getAll('date_locations').map(String).filter((location) => allowedDateLocations.has(location))
  )].slice(0, 12)
  const requestedVisibility = value(formData, 'profile_visibility')
  const fieldErrors = {}

  if (displayName.length < 1 || displayName.length > 60) fieldErrors.display_name = 'Use a display name from 1 to 60 characters.'
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fieldErrors.username = 'Username must be 3–24 lowercase letters, numbers, or underscores.'

  const birthError = birthDateError(birthDate)
  if (birthError) fieldErrors.birth_date = birthError

  if (!Number.isFinite(radius) || !Number.isInteger(radius) || radius < 1 || radius > 100) {
    fieldErrors.search_radius_km = 'Choose a whole-number search radius from 1 to 100 km.'
  }
  if (dateLocations.length < 3) fieldErrors.date_locations = 'Choose at least three kinds of places you like for dates.'
  if (bio.length > 500) fieldErrors.bio = 'Keep your date vibe to 500 characters or fewer.'
  if (!allowedVisibility.has(requestedVisibility)) fieldErrors.profile_visibility = 'Choose a valid profile visibility.'

  let location = null
  try {
    location = profileLocationFromForm(formData, profile)
  } catch (error) {
    fieldErrors.location = error.message || 'Choose your location before building your deck.'
  }

  if (Object.keys(fieldErrors).length) {
    return failure(stateful, 'Check the highlighted fields. Your entries have not been cleared.', fieldErrors)
  }

  const payload = {
    id: user.id,
    display_name: displayName,
    username,
    birth_date: birthDate,
    ...location,
    search_radius_km: radius,
    bio: bio || null,
    profile_visibility: requestedVisibility,
    interests: dateLocations,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) {
    if (isDuplicateUsernameError(error)) {
      await preserveProgressWithoutUsername(supabase, payload, profile)
      return failure(stateful, 'That username is already taken. Your other choices are still here.', { username: 'That username is already taken. Choose another one.' })
    }
    return failure(stateful, profileWriteErrorMessage(error), { form: 'We could not save your profile.' })
  }

  revalidatePath('/onboarding')
  revalidatePath('/discover')
  revalidatePath('/profile')
  redirect(pathWithMessage('/discover', 'success', 'Your deck is ready. Start swiping!'))
}
