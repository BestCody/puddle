"use server"

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  const requestHeaders = await headers()
  return (requestHeaders.get('origin') || 'http://localhost:3000').replace(/\/$/, '')
}

function ensureConfigured(path) {
  if (!isSupabaseConfigured()) redirect(pathWithMessage(path, 'error', 'Supabase is not configured yet.'))
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
  const callback = `${await siteUrl()}/auth/callback?next=/onboarding`
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callback, data: { display_name: displayName } }
  })
  if (error) redirect(pathWithMessage('/signup', 'error', error.message))
  if (data.session) redirect('/onboarding')
  redirect(`/verify-email?email=${encodeURIComponent(email)}`)
}

export async function signIn(formData) {
  ensureConfigured('/signin')
  const email = value(formData, 'email').toLowerCase()
  const password = value(formData, 'password')
  const next = safeNextPath(value(formData, 'next'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(pathWithMessage('/signin', 'error', 'Email or password was not accepted.', { next }))
  const { data: profile } = await supabase.from('profiles').select('onboarding_completed_at').eq('id', data.user.id).maybeSingle()
  redirect(profile?.onboarding_completed_at ? next : '/onboarding')
}

export async function sendMagicLink(formData) {
  ensureConfigured('/signin')
  const email = value(formData, 'email').toLowerCase()
  if (!email.includes('@')) redirect(pathWithMessage('/signin', 'error', 'Enter your email before requesting a magic link.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback?next=/dashboard`, shouldCreateUser: false }
  })
  if (error) redirect(pathWithMessage('/signin', 'error', error.message))
  redirect(pathWithMessage('/signin', 'success', 'Magic link sent. Check your inbox.'))
}

export async function signInWithOAuth(formData) {
  ensureConfigured('/signin')
  const provider = value(formData, 'provider')
  if (!['google', 'apple'].includes(provider)) redirect(pathWithMessage('/signin', 'error', 'That sign-in provider is not supported.'))
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=/onboarding` }
  })
  if (error || !data.url) redirect(pathWithMessage('/signin', 'error', error?.message || 'OAuth could not start.'))
  redirect(data.url)
}

export async function requestPasswordReset(formData) {
  ensureConfigured('/forgot-password')
  const email = value(formData, 'email').toLowerCase()
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/update-password`
  })
  if (error) redirect(pathWithMessage('/forgot-password', 'error', error.message))
  redirect(pathWithMessage('/forgot-password', 'success', 'Password reset link sent.'))
}

export async function updatePassword(formData) {
  ensureConfigured('/update-password')
  const password = value(formData, 'password')
  const confirmation = value(formData, 'password_confirmation')
  if (password.length < 10) redirect(pathWithMessage('/update-password', 'error', 'Use at least 10 characters.'))
  if (password !== confirmation) redirect(pathWithMessage('/update-password', 'error', 'The passwords do not match.'))
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect(pathWithMessage('/update-password', 'error', error.message))
  redirect(pathWithMessage('/account', 'success', 'Password updated.'))
}

export async function completeOnboarding(formData) {
  ensureConfigured('/onboarding')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/onboarding')
  const username = value(formData, 'username').toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(username)) redirect(pathWithMessage('/onboarding', 'error', 'Username must be 3–24 lowercase letters, numbers, or underscores.'))
  const interests = formData.getAll('interests').map(String).slice(0, 12)
  if (interests.length < 3) redirect(pathWithMessage('/onboarding', 'error', 'Pick at least three interests.'))
  const birthDate = value(formData, 'birth_date')
  const birthday = new Date(`${birthDate}T00:00:00Z`)
  const age = Number.isNaN(birthday.getTime()) ? -1 : Math.floor((Date.now() - birthday.getTime()) / 31557600000)
  if (age < 13) redirect(pathWithMessage('/onboarding', 'error', 'Puddle accounts require users to be at least 13.'))
  const radius = Number(value(formData, 'search_radius_km'))
  const payload = {
    id: user.id,
    display_name: value(formData, 'display_name') || user.user_metadata?.display_name || 'Puddle person',
    username,
    birth_date: birthDate,
    city: value(formData, 'city') || null,
    search_radius_km: Number.isFinite(radius) ? Math.min(100, Math.max(1, radius)) : 10,
    bio: value(formData, 'bio') || null,
    profile_visibility: value(formData, 'profile_visibility') || 'friends',
    interests,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
  const { error } = await supabase.from('profiles').upsert(payload)
  if (error) redirect(pathWithMessage('/onboarding', 'error', error.message))
  revalidatePath('/dashboard')
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
  if (error) redirect(pathWithMessage('/account', 'error', error.message))
  revalidatePath('/account')
  revalidatePath('/dashboard')
  redirect(pathWithMessage('/account', 'success', 'Profile saved.'))
}

export async function updateEmail(formData) {
  ensureConfigured('/account')
  const email = value(formData, 'email').toLowerCase()
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${await siteUrl()}/auth/callback?next=/account` })
  if (error) redirect(pathWithMessage('/account', 'error', error.message))
  redirect(pathWithMessage('/account', 'success', 'Check both inboxes to confirm the email change.'))
}

export async function revokeOtherSessions() {
  ensureConfigured('/account')
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) redirect(pathWithMessage('/account', 'error', error.message))
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
  } catch (error) {
    redirect(pathWithMessage('/account', 'error', error.message))
  }
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) redirect(pathWithMessage('/account', 'error', error.message))
  redirect('/?account=deleted')
}
