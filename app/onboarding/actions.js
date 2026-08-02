"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { ensureProfile } from '@/lib/auth/profile'
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

function ageFromBirthDate(birthDate, now = new Date()) {
  const match = String(birthDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return -1
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const birthday = new Date(Date.UTC(year, month - 1, day))
  if (
    birthday.getUTCFullYear() !== year ||
    birthday.getUTCMonth() !== month - 1 ||
    birthday.getUTCDate() !== day ||
    birthday > now
  ) return -1

  let age = now.getUTCFullYear() - year
  const monthDifference = now.getUTCMonth() - (month - 1)
  if (monthDifference < 0 || (monthDifference === 0 && now.getUTCDate() < day)) age -= 1
  return age
}

async function preserveProgressWithoutUsername(supabase, payload, profile) {
  const retryPayload = { ...payload, username: profile?.username || null }
  delete retryPayload.onboarding_completed_at
  await supabase.from('profiles').upsert(retryPayload, { onConflict: 'id' })
}

export async function completeDateOnboarding(formData) {
  if (!isSupabaseConfigured()) {
    redirect(pathWithMessage('/onboarding', 'error', 'Accounts are temporarily unavailable. Please try again later.'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/onboarding')

  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) redirect(pathWithMessage('/onboarding', 'error', 'We could not load your profile. Refresh the page and try again.'))

  const displayName = value(formData, 'display_name') || profile?.display_name || user.user_metadata?.display_name || 'Puddle person'
  const username = value(formData, 'username').toLowerCase()
  const birthDate = value(formData, 'birth_date')
  const radius = Number(value(formData, 'search_radius_km'))
  const dateLocations = [...new Set(
    formData.getAll('date_locations').map(String).filter((location) => allowedDateLocations.has(location))
  )].slice(0, 12)
  const requestedVisibility = value(formData, 'profile_visibility')
  const profileVisibility = allowedVisibility.has(requestedVisibility) ? requestedVisibility : 'public'

  if (displayName.length < 1 || displayName.length > 60) {
    redirect(pathWithMessage('/onboarding', 'error', 'Add a display name between 1 and 60 characters.'))
  }
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    redirect(pathWithMessage('/onboarding', 'error', 'Username must be 3–24 lowercase letters, numbers, or underscores.'))
  }
  const age = ageFromBirthDate(birthDate)
  if (age < 0) redirect(pathWithMessage('/onboarding', 'error', 'Enter a real birth date in YYYY-MM-DD format.'))
  if (age < 13) redirect(pathWithMessage('/onboarding', 'error', 'Puddle accounts require users to be at least 13.'))
  if (dateLocations.length < 3) {
    redirect(pathWithMessage('/onboarding', 'error', 'Choose at least three kinds of places you like for dates.'))
  }

  let location
  try {
    location = profileLocationFromForm(formData, profile)
  } catch (error) {
    redirect(pathWithMessage('/onboarding', 'error', error.message || 'Choose your location before building your deck.'))
  }

  const payload = {
    id: user.id,
    display_name: displayName,
    username,
    birth_date: birthDate,
    ...location,
    search_radius_km: Number.isFinite(radius) ? Math.min(100, Math.max(1, Math.round(radius))) : 10,
    bio: value(formData, 'bio') || null,
    profile_visibility: profileVisibility,
    interests: dateLocations,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) {
    if (isDuplicateUsernameError(error)) {
      await preserveProgressWithoutUsername(supabase, payload, profile)
      redirect(pathWithMessage('/onboarding', 'error', 'That username is already taken. Your other choices were saved—choose another username.'))
    }
    redirect(pathWithMessage('/onboarding', 'error', profileWriteErrorMessage(error)))
  }

  revalidatePath('/onboarding')
  revalidatePath('/discover')
  revalidatePath('/profile')
  redirect(pathWithMessage('/discover', 'success', 'Your deck is ready. Start swiping!'))
}
