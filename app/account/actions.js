"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { profileLocationFromForm } from '@/lib/app/profile-location'
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

export async function updateDateProfile(formData) {
  if (!isSupabaseConfigured()) {
    redirect(pathWithMessage('/account', 'error', 'Accounts are temporarily unavailable. Please try again later.'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/account')

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('city,region,country,country_code,timezone,location_label,location_source,location_accuracy_m,latitude,longitude')
    .eq('id', user.id)
    .maybeSingle()

  const displayName = value(formData, 'display_name')
  const username = value(formData, 'username').toLowerCase()
  const radius = Number(value(formData, 'search_radius_km'))
  const requestedVisibility = value(formData, 'profile_visibility')
  const dateLocations = [...new Set(
    formData.getAll('date_locations').map(String).filter((location) => allowedDateLocations.has(location))
  )].slice(0, 12)

  if (displayName.length < 1 || displayName.length > 60) {
    redirect(pathWithMessage('/account', 'error', 'Add a display name between 1 and 60 characters.'))
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    redirect(pathWithMessage('/account', 'error', 'Username must be 3–24 lowercase letters, numbers, or underscores.'))
  }
  if (!Number.isFinite(radius) || radius < 1 || radius > 100) {
    redirect(pathWithMessage('/account', 'error', 'Choose a search radius from 1 to 100 km.'))
  }
  if (dateLocations.length < 3) {
    redirect(pathWithMessage('/account', 'error', 'Choose at least three kinds of places you like for dates.'))
  }

  let location
  try {
    location = profileLocationFromForm(formData, currentProfile || {})
  } catch (error) {
    redirect(pathWithMessage('/account', 'error', error.message || 'Choose a valid location.'))
  }

  const { error } = await supabase.from('profiles').update({
    display_name: displayName,
    username,
    ...location,
    bio: value(formData, 'bio') || null,
    search_radius_km: Math.round(radius),
    profile_visibility: allowedVisibility.has(requestedVisibility) ? requestedVisibility : 'public',
    interests: dateLocations,
    updated_at: new Date().toISOString()
  }).eq('id', user.id)

  if (error) {
    const message = isDuplicateUsernameError(error)
      ? 'That username is already taken. Choose another username.'
      : profileWriteErrorMessage(error, 'We could not save your profile. Please try again.')
    redirect(pathWithMessage('/account', 'error', message))
  }

  revalidatePath('/account')
  revalidatePath('/profile')
  revalidatePath('/discover')
  redirect(pathWithMessage('/account', 'success', 'Profile and date preferences saved.'))
}
