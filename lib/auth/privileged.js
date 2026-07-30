import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

function normalizedRoles(roles) { return Array.isArray(roles) ? roles.map(String).filter(Boolean) : [] }

async function privilegedSession(requiredRoles = []) {
  if (!isSupabaseConfigured()) return { error: 'unavailable', status: 503 }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthenticated', status: 401, supabase }
  const { data: access, error } = await supabase.rpc('privileged_access_v1', { required_roles: normalizedRoles(requiredRoles) })
  if (error || !access?.allowed) return { error: 'forbidden', status: 403, user, supabase }
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const aal2 = assurance?.currentLevel === 'aal2'
  return { user, supabase, access, assurance, aal2, status: aal2 ? 200 : 428, error: aal2 ? null : 'mfa_required' }
}

export async function requirePrivileged(requiredRoles = [], { allowMfaEnrollment = false } = {}) {
  const session = await privilegedSession(requiredRoles)
  if (session.error === 'unauthenticated') redirect('/signin?next=/admin')
  if (session.error === 'forbidden') redirect('/discover?error=Privileged%20access%20is%20required.')
  if (session.error === 'unavailable') redirect('/signin?error=Administration%20is%20temporarily%20unavailable.')
  if (session.error === 'mfa_required' && !allowMfaEnrollment) redirect('/admin/mfa')
  return session
}

export async function requirePrivilegedApi(requiredRoles = [], { allowMfaEnrollment = false } = {}) {
  const session = await privilegedSession(requiredRoles)
  if (session.error && !(allowMfaEnrollment && session.error === 'mfa_required')) {
    const error = new Error(session.error === 'mfa_required' ? 'Multi-factor authentication is required.' : session.error === 'forbidden' ? 'Privileged access is required.' : 'Authentication is required.')
    error.status = session.status
    throw error
  }
  return session
}
