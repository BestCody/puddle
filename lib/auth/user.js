import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { pathWithMessage } from './redirect'

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return { user: null, profile: null, configured: false }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { user: null, profile: null, configured: true }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, username, birth_date, city, search_radius_km, bio, profile_visibility, onboarding_completed_at, suspended_at, role, interests')
    .eq('id', user.id)
    .maybeSingle()

  return { user, profile, configured: true, supabase }
}

export async function requireUser({ onboarding = false } = {}) {
  const result = await getCurrentUser()
  if (!result.configured) redirect(pathWithMessage('/signin', 'error', 'Accounts are temporarily unavailable. Please try again later.'))
  if (!result.user) redirect('/signin?next=/discover')
  if (result.profile?.suspended_at) {
    await result.supabase.auth.signOut()
    redirect(pathWithMessage('/signin', 'error', 'This account is suspended. Contact support for help.'))
  }
  if (onboarding && !result.profile?.onboarding_completed_at) redirect('/onboarding')
  return result
}
