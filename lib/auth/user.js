import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { ensureProfile } from './profile'
import { pathWithMessage } from './redirect'

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return { user: null, profile: null, configured: false }

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { user: null, profile: null, configured: true, supabase }

  const { profile, error: profileError, created } = await ensureProfile(supabase, user)
  return { user, profile, profileError, profileRecovered: Boolean(created), configured: true, supabase }
}

export async function requireUser({ onboarding = false } = {}) {
  const result = await getCurrentUser()
  if (!result.configured) {
    redirect(pathWithMessage('/signin', 'error', 'Accounts are temporarily unavailable. Please try again later.'))
  }
  if (!result.user) redirect('/signin?next=/discover')
  if (result.profileError) {
    redirect(pathWithMessage('/signin', 'error', 'We signed you in, but could not load your profile. Please sign in again.'))
  }
  if (result.profile?.suspended_at) {
    await result.supabase.auth.signOut()
    redirect(pathWithMessage('/signin', 'error', 'This account is suspended. Contact support for help.'))
  }
  if (onboarding && !result.profile?.onboarding_completed_at) redirect('/onboarding')
  return result
}
