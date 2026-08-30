import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { isValidEmail, MAX_PASSWORD_LENGTH } from '@/lib/app/input-validation'
import { createClient } from '@/lib/supabase/server'

function value(formData, key) {
  return String(formData.get(key) || '').trim()
}

function rawValue(formData, key) {
  return String(formData.get(key) || '')
}

function publicError(error, fallback) {
  const message = String(error?.message || '').trim()
  if (!message) return fallback
  if (/supabase|environment|api key|service role|configuration|project|provider.*enabled|database|schema|policy|permission/i.test(message)) return fallback
  return message
}

async function clearLocalAuthSession(supabase) {
  await supabase.auth.signOut({ scope: 'local' })
}

export async function registerAccount(formData) {
  if (!isSupabaseConfigured()) return { error: 'Accounts are temporarily unavailable. Please try again later.' }

  const displayName = value(formData, 'display_name')
  const email = value(formData, 'email').toLowerCase()
  const password = rawValue(formData, 'password')
  const termsAccepted = value(formData, 'terms_accepted') === 'yes'

  if (displayName.length < 1 || displayName.length > 60) return { error: 'Add a display name between 1 and 60 characters.' }
  if (!isValidEmail(email)) return { error: 'Enter a valid email address.' }
  if (password.length < 10 || password.length > MAX_PASSWORD_LENGTH) return { error: `Use a password from 10 to ${MAX_PASSWORD_LENGTH} characters.` }
  if (!termsAccepted) return { error: 'Agree to the Terms and Privacy Policy before creating an account.' }

  try {
    const acceptedAt = new Date().toISOString()
    const supabase = await createClient()
    await clearLocalAuthSession(supabase)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, legal_consent_at: acceptedAt, legal_consent_version: 'current' } }
    })
    if (error || !data?.user) return { error: publicError(error, 'We could not create your account. Please try again.') }

    let user = data.user
    if (!data.session) {
      const admin = createAdminClient()
      const { error: confirmationError } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
      if (confirmationError) return { error: 'We could not finish creating your account. Please try again.' }

      const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError || !signedIn?.user) return { error: 'Your account was created, but we could not sign you in. Please return to the home page.' }
      user = signedIn.user
    }

    const { profile, error: profileError } = await ensureProfile(supabase, user)
    if (profileError) return { error: 'Your account was created, but your profile could not be prepared. Please retry.' }

    await supabase.from('security_events').insert({
      profile_id: user.id,
      event_type: 'legal_consent_accepted',
      metadata: { terms: true, privacy: true, version: 'current', accepted_at: acceptedAt, source: 'email_signup' }
    })

    return { destination: authenticatedDestination(profile, '/onboarding') }
  } catch (error) {
    return { error: publicError(error, 'We could not create your account. Please try again.') }
  }
}
