import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { SERVER_LATENCY_BUDGET_MS, elapsedMs, latencyStart, recordServerLatency } from '@/lib/performance/server-latency'
import { ensureProfile } from './profile'
import { pathWithMessage } from './redirect'

const loadCurrentUser = cache(async () => {
  const sessionStartedAt = latencyStart()
  if (!isSupabaseConfigured()) return { user: null, profile: null, configured: false }

  const supabase = await createClient()
  const authStartedAt = latencyStart()
  const { data: { user }, error } = await supabase.auth.getUser()
  const authMs = elapsedMs(authStartedAt)
  recordServerLatency('page_auth_user', authMs, SERVER_LATENCY_BUDGET_MS.pageAuthUser)
  if (error || !user) {
    recordServerLatency('page_session', elapsedMs(sessionStartedAt), SERVER_LATENCY_BUDGET_MS.pageSession, { authenticated: false })
    return { user: null, profile: null, configured: true, supabase }
  }

  const profileStartedAt = latencyStart()
  const { profile, error: profileError, created } = await ensureProfile(supabase, user)
  const profileMs = elapsedMs(profileStartedAt)
  recordServerLatency('page_profile', profileMs, SERVER_LATENCY_BUDGET_MS.pageProfile, { recovered: Boolean(created) })
  recordServerLatency('page_session', elapsedMs(sessionStartedAt), SERVER_LATENCY_BUDGET_MS.pageSession, { authenticated: true })
  return { user, profile, profileError, profileRecovered: Boolean(created), configured: true, supabase }
})

export async function getCurrentUser() {
  return loadCurrentUser()
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
  if (result.profile?.suspended_at || result.profile?.banned_at) {
    await result.supabase.auth.signOut()
    redirect(pathWithMessage('/signin', 'error', result.profile?.banned_at
      ? 'This account is banned. Contact support if you believe this is an error.'
      : 'This account is suspended. Contact support for help.'))
  }
  if (onboarding && !result.profile?.onboarding_completed_at) redirect('/onboarding')
  return result
}
