"use server"

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { isDuplicateUsernameError, profileWriteErrorMessage } from '@/lib/auth/errors'

const allowedInterests = new Set(['Live music','Nightlife','Food','Pop-ups','Art','Film','Workshops','Sports','Wellness','Markets','Comedy','Outdoors'])
const allowedVisibility = new Set(['hidden', 'friends', 'mutuals', 'attendees', 'public'])

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  const requestHeaders = await headers()
  return (requestHeaders.get('origin') || 'http://localhost:3000').replace(/\/$/, '')
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

function ageFromBirthDate(birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return -1
  const birthday = new Date(`${birthDate}T00:00:00Z`)
  if (Number.isNaN(birthday.getTime())) return -1
  const today = new Date()
  let age = today.getUTCFullYear() - birthday.getUTCFullYear()
  const month = today.getUTCMonth() - birthday.getUTCMonth()
  if (month < 0 || (month === 0 && today.getUTCDate() < birthday.getUTCDate())) age -= 1
  return age
}

async function authenticatedProfile(path) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=${encodeURIComponent(path)}`)
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
  if (birthDate && ageFromBirthDate(birthDate) < 13) return { error: 'Puddle accounts require users to be at least 13.' }
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
  ensureConfigured('/signup')
  const displayName = value(formData, 'display_name')
  const email = value(formData, 'email').toLowerCase()
  const password = value(formData, 'password')
  if (displayName.length < 1 || displayName.length > 60) redirect(pathWithMessage('/signup', 'error', 'Add a display name between 1 and 60 characters.'))
  if (!email.includes('@')) redirect(pathWithMessage('/signup', 'error', 'Enter a valid email address.'))
  if (password.length < 10) redirect(pathWithMessage('/signup', 'error', 'Use at least 10 characters for your password.'))

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  })
  if (error || !data.user) redirect(pathWithMessage('/signup', 'error', publicError(error, 'We could not create your account. Please try again.')))

  let user = data.user
  if (!data.session) {
    let admin
    try {
      admin = createAdminClient()
    } catch {
      redirect(pathWithMessage('/signup', 'error', 'We could not finish creating your account. Please try again.'))
    }

    const { error: confirmationError } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
    if (confirmationError) redirect(pathWithMessage('/signup', 'error', 'We could not finish creating your account. Please try again.'))

    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError || !signedIn.user) redirect(pathWithMessage('/signup', 'error', 'Your account was created, but we could not sign you in. Please use the sign-in page.'))
    user = signedIn.user
  }

  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) redirect(pathWithMessage('/onboarding', 'error', 'Your account was created, but your profile could not be prepared. Please retry.'))
  redirect(authenticatedDestination(profile, '/onboarding'))
}

export async function signIn(formData) {
  ensureConfigured('/signin')
  const email = value(formData, 'email').toLowerCase()
  const password = value(formData, 'password')
  const next = safeNextPath(value(formData, 'next'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) redirect(pathWithMessage('/signin', 'error', 'Email or password was not accepted.', { next }))
  const { profile, error: profileError } = await ensureProfile(supabase, data.user)
  if (profileError) redirect(pathWithMessage('/signin', 'error', 'You are signed in, but your profile could not be loaded. Please retry.', { next }))
  redirect(authenticatedDestination(profile, next))
}

export async function sendLoginCode(formData) {
  ensureConfigured('/signin')
  const email = value(formData, 'email').toLowerCase()
  const next = safeNextPath(value(formData, 'next'))
  if (!email.includes('@')) redirect(pathWithMessage('/signin', 'error', 'Enter a valid email address.', { next }))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) redirect(pathWithMessage('/signin', 'error', publicError(error, 'We could not send a login code. Please try again.'), { next }))
  redirect(pathWithMessage('/signin', 'success', 'We emailed you a one-time login code.', { code_sent: '1', email, next }))
}

export async function verifyLoginCode(formData) {
  ensureConfigured('/signin')
  const email = value(formData, 'email').toLowerCase()
  const token = value(formData, 'token').replace(/[\s-]/g, '')
  const next = safeNextPath(value(formData, 'next'))
  const retry = { code_sent: '1', email, next }

  if (!email.includes('@')) redirect(pathWithMessage('/signin', 'error', 'Enter a valid email address.', retry))
  if (!/^\d{6,8}$/.test(token)) redirect(pathWithMessage('/signin', 'error', 'Enter the code from your email.', retry))

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  if (error || !data.user) redirect(pathWithMessage('/signin', 'error', 'That code was not accepted. Request a new code and try again.', retry))
  const { profile, error: profileError } = await ensureProfile(supabase, data.user)
  if (profileError) redirect(pathWithMessage('/signin', 'error', 'You are signed in, but your profile could not be loaded. Please retry.', { next }))
  redirect(authenticatedDestination(profile, next))
}

export async function signInWithOAuth(formData) {
  ensureConfigured('/signin')
  const provider = value(formData, 'provider')
  if (provider !== 'google') redirect(pathWithMessage('/signin', 'error', 'That sign-in option is not supported.'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=/onboarding` }
  })
  if (error || !data.url) redirect(pathWithMessage('/signin', 'error', publicError(error, 'That sign-in option is temporarily unavailable.')))
  redirect(data.url)
}

export async function requestPasswordReset(formData) {
  ensureConfigured('/forgot-password')
  const email = value(formData, 'email').toLowerCase()
  if (!email.includes('@')) redirect(pathWithMessage('/forgot-password', 'error', 'Enter a valid email address.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/update-password`
  })
  if (error) redirect(pathWithMessage('/forgot-password', 'error', publicError(error, 'We could not send a reset link. Please try again.')))
  redirect(pathWithMessage('/forgot-password', 'success', 'If that email has a Puddle account, a password reset link is on the way.'))
}

export async function updatePassword(formData) {
  ensureConfigured('/update-password')
  const password = value(formData, 'password')
  const confirmation = value(formData, 'password_confirmation')
  if (password.length < 10) redirect(pathWithMessage('/update-password', 'error', 'Use at least 10 characters.'))
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
  if (!user) redirect('/signin?next=/account')
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
  if (!email.includes('@')) redirect(pathWithMessage('/account', 'error', 'Enter a valid email address.'))
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
  if (!user) redirect('/signin')
  let admin
  try {
    admin = createAdminClient()
  } catch {
    redirect(pathWithMessage('/account', 'error', 'Account deletion is temporarily unavailable. Please try again later.'))
  }
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) redirect(pathWithMessage('/account', 'error', 'We could not delete your account. Please try again later.'))
  redirect('/?account=deleted')
}