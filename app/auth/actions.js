"use server"

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { normalizeOrigin, requestOrigin } from '@/lib/auth/origin'
import { pathWithMessage } from '@/lib/auth/redirect'
import { ensureProfile } from '@/lib/auth/profile'
import { startGoogleOAuth } from '@/lib/auth/google-oauth'
import { isDuplicateUsernameError, profileWriteErrorMessage } from '@/lib/auth/errors'
import { birthDateError, isValidEmail, MAX_PASSWORD_LENGTH } from '@/lib/app/input-validation'
import { registerAccount } from '@/lib/auth/sign-up'

const allowedInterests = new Set(['Live music','Nightlife','Food','Pop-ups','Art','Film','Workshops','Sports','Wellness','Markets','Comedy','Outdoors'])
const allowedVisibility = new Set(['hidden', 'friends', 'mutuals', 'attendees', 'public'])

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

function rawValue(formData, key) {
  return String(formData.get(key) || '')
}

async function siteUrl() {
  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://puddle.you'
  return requestOrigin(await headers(), 'http://localhost:3000')
}

async function clearLocalAuthSession(supabase) {
  await supabase.auth.signOut({ scope: 'local' })
}

function publicError(error, fallback) {
  const message = String(error?.message || '').trim()
  if (!message) return fallback
  if (/supabase|environment|api key|service role|configuration|project|provider.*enabled|database|schema|policy|permission/i.test(message)) return fallback
  return message
}

function ensureConfigured(path) {
  if (!isSupabaseConfigured()) redirect(pathWithMessage(path, 'error', 'Accounts are temporarily unavailable. Please try again later.'))
}

async function authenticatedProfile(path) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/?next=${encodeURIComponent(path)}`)
  const { profile, error } = await ensureProfile(supabase, user)
  if (error) redirect(pathWithMessage(path, 'error', 'We could not load your profile. Refresh the page and try again.'))
  return { supabase, user, profile }
}

function onboardingInput(formData, user, profile, { complete }) {
  const displayName = value(formData, 'display_name') || profile?.display_name || user.user_metadata?.display_name || 'Puddle person'
  const username = value(formData, 'username').toLowerCase()
  const birthDate = value(formData, 'birth_date')
  const city = value(formData, 'city')
  const interests = [...new Set(formData.getAll('interests').map(String).filter((interest) => allowedInterests.has(interest)))].slice(0, 12)
  const radius = Number(value(formData, 'search_radius_km'))
  const requestedVisibility = value(formData, 'profile_visibility')
  const profileVisibility = allowedVisibility.has(requestedVisibility) ? requestedVisibility : profile?.profile_visibility || 'friends'

  if (displayName.length < 1 || displayName.length > 60) return { error: 'Add a display name between 1 and 60 characters.' }
  if (username && !/^[a-z0-9_]{3,24}$/.test(username)) return { error: 'Username must be 3–24 lowercase letters, numbers, or underscores.' }
  if (birthDate) {
    const dateError = birthDateError(birthDate)
    if (dateError) return { error: dateError }
  }
  if (complete && !username) return { error: 'Choose a username before building your feed.' }
  if (complete && !birthDate) return { error: 'Add your birth date before building your feed.' }
  if (complete && !city) return { error: 'Add your city before building your feed.' }
  if (complete && interests.length < 3) return { error: 'Pick at least three interests.' }

  const payload = {
    id: user.id,
    display_name: displayName,
    username: username || null,
    birth_date: birthDate || null,
    city: city || null,
    search_radius_km: Number.isFinite(radius) ? Math.min(100, Math.max(1, radius)) : profile?.search_radius_km || 10,
    bio: value(formData, 'bio') || null,
    profile_visibility: profileVisibility,
    interests,
    updated_at: new Date().toISOString()
  }
  if (complete) payload.onboarding_completed_at = new Date().toISOString()
  return { payload }
}

async function preserveOnboardingProgressWithoutUsername(supabase, payload, profile) {
  const retryPayload = { ...payload, username: profile?.username || null }
  delete retryPayload.onboarding_completed_at
  await supabase.from('profiles').upsert(retryPayload, { onConflict: 'id' })
}

export async function signUp(formData) {
  const result = await registerAccount(formData)
  if (result.error) redirect(pathWithMessage('/signup', 'error', result.error))
  redirect(result.destination)
}

export async function startGoogleSignup(formData) {
  ensureConfigured('/signup')
  const provider = value(formData, 'provider')
  const signupIntent = value(formData, 'signup_intent') === '1'
  if (provider !== 'google' || !signupIntent) redirect(pathWithMessage('/signup', 'error', 'That sign-in option is not supported.'))
  if (signupIntent && value(formData, 'terms_accepted') !== 'yes') redirect(pathWithMessage('/signup', 'error', 'Agree to the Terms and Privacy Policy before creating an account.'))
  const supabase = await createClient()
  const { data, error } = await startGoogleOAuth(supabase, await headers(), '/onboarding', true)
  if (error || !data.url) redirect(pathWithMessage('/signup', 'error', publicError(error, 'That sign-in option is temporarily unavailable.')))
  redirect(data.url)
}

export async function requestPasswordReset(formData) {
  ensureConfigured('/forgot-password')
  const email = value(formData, 'email').toLowerCase()
  if (!isValidEmail(email)) redirect(pathWithMessage('/forgot-password', 'error', 'Enter a valid email address.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/update-password`
  })
  if (error) redirect(pathWithMessage('/forgot-password', 'error', publicError(error, 'We could not send a reset link. Please try again.')))
  redirect(pathWithMessage('/forgot-password', 'success', 'If that email has a Puddle account, a password reset link is on the way.'))
}

export async function updatePassword(formData) {
  ensureConfigured('/update-password')
  const password = rawValue(formData, 'password')
  const confirmation = rawValue(formData, 'password_confirmation')
  if (password.length < 10 || password.length > MAX_PASSWORD_LENGTH) redirect(pathWithMessage('/update-password', 'error', `Use a password from 10 to ${MAX_PASSWORD_LENGTH} characters.`))
  if (password !== confirmation) redirect(pathWithMessage('/update-password', 'error', 'The passwords do not match.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect(pathWithMessage('/update-password', 'error', publicError(error, 'We could not update your password. Please request a new reset link and try again.')))
  redirect(pathWithMessage('/account', 'success', 'Password updated.'))
}

export async function saveOnboardingDraft(formData) {
  ensureConfigured('/onboarding')
  const { supabase, user, profile } = await authenticatedProfile('/onboarding')
  const { payload, error: validationError } = onboardingInput(formData, user, profile, { complete: false })
  if (validationError) redirect(pathWithMessage('/onboarding', 'error', validationError))

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) {
    if (isDuplicateUsernameError(error)) {
      await preserveOnboardingProgressWithoutUsername(supabase, payload, profile)
      redirect(pathWithMessage('/onboarding', 'error', 'That username is already taken. Your other progress was saved.'))
    }
    redirect(pathWithMessage('/onboarding', 'error', profileWriteErrorMessage(error, 'We could not save your progress. Please try again.')))
  }
  revalidatePath('/onboarding')
  redirect(pathWithMessage('/onboarding', 'success', 'Progress saved. You can sign out and continue later.'))
}

export async function completeOnboarding(formData) {
  ensureConfigured('/onboarding')
  const { supabase, user, profile } = await authenticatedProfile('/onboarding')
  const { payload, error: validationError } = onboardingInput(formData, user, profile, { complete: true })
  if (validationError) redirect(pathWithMessage('/onboarding', 'error', validationError))

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) {
    if (isDuplicateUsernameError(error)) {
      await preserveOnboardingProgressWithoutUsername(supabase, payload, profile)
      redirect(pathWithMessage('/onboarding', 'error', 'That username is already taken. Your other progress was saved—choose another username.'))
    }
    redirect(pathWithMessage('/onboarding', 'error', profileWriteErrorMessage(error)))
  }
  revalidatePath('/dashboard')
  revalidatePath('/onboarding')
  redirect('/dashboard?success=Welcome+to+Puddle!')
}

export async function updateProfile(formData) {
  ensureConfigured('/account')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/account')
  const { error } = await supabase.from('profiles').update({
    display_name: value(formData, 'display_name'),
    username: value(formData, 'username').toLowerCase(),
    city: value(formData, 'city') || null,
    bio: value(formData, 'bio') || null,
    search_radius_km: Number(value(formData, 'search_radius_km')) || 10,
    profile_visibility: value(formData, 'profile_visibility') || 'friends',
    updated_at: new Date().toISOString()
  }).eq('id', user.id)
  if (error) redirect(pathWithMessage('/account', 'error', profileWriteErrorMessage(error, 'We could not save your profile. Please try again.')))
  revalidatePath('/account')
  revalidatePath('/dashboard')
  redirect(pathWithMessage('/account', 'success', 'Profile saved.'))
}

export async function updateEmail(formData) {
  ensureConfigured('/account')
  const email = value(formData, 'email').toLowerCase()
  if (!isValidEmail(email)) redirect(pathWithMessage('/account', 'error', 'Enter a valid email address.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${await siteUrl()}/auth/callback?next=/account` })
  if (error) redirect(pathWithMessage('/account', 'error', publicError(error, 'We could not update your email. Please try again.')))
  redirect(pathWithMessage('/account', 'success', 'Check both inboxes to confirm the email change.'))
}

export async function revokeOtherSessions() {
  ensureConfigured('/account')
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) redirect(pathWithMessage('/account', 'error', publicError(error, 'We could not sign out your other sessions.')))
  redirect(pathWithMessage('/account', 'success', 'Other sessions were signed out.'))
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: 'local' })
  }
  redirect('/')
}

export async function deleteAccount(formData) {
  ensureConfigured('/account')
  if (value(formData, 'confirmation') !== 'DELETE') redirect(pathWithMessage('/account', 'error', 'Type DELETE exactly to remove your account.'))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  let admin
  try {
    admin = createAdminClient()
  } catch {
    redirect(pathWithMessage('/account', 'error', 'Account deletion is temporarily unavailable. Please try again later.'))
  }
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) redirect(pathWithMessage('/account', 'error', 'We could not delete your account. Please try again later.'))
  await clearLocalAuthSession(supabase)
  redirect('/?account=deleted')
}
