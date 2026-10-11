"use server"

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { siteOrigin } from '@/lib/auth/origin'
import { pathWithMessage } from '@/lib/auth/redirect'
import { startGoogleOAuth } from '@/lib/auth/google-oauth'
import { isValidEmail, MAX_PASSWORD_LENGTH } from '@/lib/app/input-validation'
import { registerAccount } from '@/lib/auth/sign-up'

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

function rawValue(formData, key) {
  return String(formData.get(key) || '')
}

async function siteUrl() {
  return siteOrigin(await headers())
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
