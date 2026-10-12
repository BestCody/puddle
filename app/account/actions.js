"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { isDuplicateUsernameError, profileWriteErrorMessage } from '@/lib/auth/errors'
import { pathWithMessage } from '@/lib/auth/redirect'
import { normalizeProfileInterests } from '@/lib/app/profile-interests'
import { settingsActionDestination } from '@/lib/app/settings-navigation'

const allowedVisibility = new Set(['hidden', 'friends', 'mutuals', 'attendees', 'public'])
const allowedAppearance = new Set(['light', 'dark', 'system'])
const allowedProfileThemes = new Set(['red', 'yellow', 'green', 'blue', 'grey', 'purple'])
const appearancePaths = ['/account', '/profile', '/discover', '/map', '/plans', '/matches', '/membership', '/create/post']

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

function checked(formData, key) {
  return formData.get(key) === 'on'
}

function revalidateAppearancePaths() {
  for (const path of appearancePaths) revalidatePath(path)
}

async function accountClient() {
  if (!isSupabaseConfigured()) redirect(pathWithMessage('/account', 'error', 'Accounts are temporarily unavailable. Please try again later.'))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/account')
  return { supabase, user }
}

export async function updateDateProfile(formData) {
  const destination = settingsActionDestination(formData, 'profile')
  const { supabase, user } = await accountClient()
  const displayName = value(formData, 'display_name')
  const username = value(formData, 'username').toLowerCase()
  const bio = value(formData, 'bio')
  const requestedVisibility = value(formData, 'profile_visibility')

  if (displayName.length < 1 || displayName.length > 60) redirect(pathWithMessage(destination, 'error', 'Add a display name between 1 and 60 characters.'))
  if (!/^[a-z0-9_]{3,24}$/.test(username)) redirect(pathWithMessage(destination, 'error', 'Username must be 3–24 lowercase letters, numbers, or underscores.'))
  if (bio.length > 500) redirect(pathWithMessage(destination, 'error', 'Keep your date vibe to 500 characters or fewer.'))
  if (!allowedVisibility.has(requestedVisibility)) redirect(pathWithMessage(destination, 'error', 'Choose a valid profile visibility.'))

  const { data, error } = await supabase.from('profiles').update({
    display_name: displayName,
    username,
    bio: bio || null,
    interests: normalizeProfileInterests(formData.getAll('date_locations')),
    profile_visibility: requestedVisibility,
    updated_at: new Date().toISOString()
  }).eq('id', user.id).select('id').maybeSingle()

  if (error || !data) {
    const message = isDuplicateUsernameError(error)
      ? 'That username is already taken. Choose another username.'
      : profileWriteErrorMessage(error, 'We could not save your profile. Please try again.')
    redirect(pathWithMessage(destination, 'error', message))
  }

  revalidatePath('/account')
  revalidatePath('/profile')
  revalidatePath('/discover')
  redirect(pathWithMessage(destination, 'success', 'Profile saved.'))
}

export async function updateAppearance(formData) {
  const destination = settingsActionDestination(formData, 'appearance')
  const { supabase, user } = await accountClient()
  const appearanceTheme = value(formData, 'appearance_theme')
  const profileTheme = value(formData, 'profile_theme')
  if (!allowedAppearance.has(appearanceTheme) || !allowedProfileThemes.has(profileTheme)) {
    redirect(pathWithMessage(destination, 'error', 'Choose valid appearance settings.'))
  }
  const { data, error } = await supabase.from('profiles').update({
    appearance_theme: appearanceTheme,
    profile_theme: profileTheme,
    updated_at: new Date().toISOString()
  }).eq('id', user.id).select('id').maybeSingle()
  if (error || !data) redirect(pathWithMessage(destination, 'error', 'We could not save your appearance.'))
  revalidateAppearancePaths()
  redirect(pathWithMessage(destination, 'success', 'Appearance saved.'))
}

export async function updateNotificationPreferences(formData) {
  const destination = settingsActionDestination(formData, 'notifications')
  const { supabase, user } = await accountClient()
  const payload = {
    profile_id: user.id,
    in_app_enabled: checked(formData, 'in_app_enabled'),
    friend_requests: checked(formData, 'friend_requests'),
    shares: checked(formData, 'shares'),
    messages: checked(formData, 'messages'),
    comments: checked(formData, 'comments'),
    event_reminders: checked(formData, 'event_reminders'),
    event_changes: checked(formData, 'event_changes'),
    host_announcements: checked(formData, 'host_announcements'),
    marketing: checked(formData, 'marketing'),
    timezone: value(formData, 'timezone') || 'America/Toronto',
    updated_at: new Date().toISOString()
  }
  const { error } = await supabase.from('notification_preferences').upsert(payload, { onConflict: 'profile_id' })
  if (error) redirect(pathWithMessage(destination, 'error', 'We could not save your notification preferences.'))
  revalidatePath('/account')
  redirect(pathWithMessage(destination, 'success', 'Notification preferences saved.'))
}

export async function markNotificationRead(formData) {
  const destination = settingsActionDestination(formData, 'notifications')
  const { supabase, user } = await accountClient()
  const notificationId = Number(value(formData, 'notification_id'))
  if (!Number.isFinite(notificationId)) redirect(destination)
  const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId).eq('profile_id', user.id).select('id').maybeSingle()
  if (error || !data) redirect(pathWithMessage(destination, 'error', 'That notification could not be marked as read.'))
  revalidatePath('/account')
  redirect(destination)
}

export async function markAllNotificationsRead(formData) {
  const destination = settingsActionDestination(formData, 'notifications')
  const { supabase, user } = await accountClient()
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', user.id).is('read_at', null)
  if (error) redirect(pathWithMessage(destination, 'error', 'Notifications could not be marked as read.'))
  revalidatePath('/account')
  redirect(destination)
}
