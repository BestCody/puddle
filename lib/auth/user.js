import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { SERVER_LATENCY_BUDGET_MS, elapsedMs, latencyStart, recordServerLatency } from '@/lib/performance/server-latency'
import { ensureProfile, profileSelect } from './profile'
import { pathWithMessage } from './redirect'

const VERIFIED_PRODUCT_USER_HEADER = 'x-puddle-verified-user-id'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function productRouteContext() {
  try {
    const requestHeaders = await headers()
    const productRoute = requestHeaders.get('x-puddle-product-route') === '1'
    const verifiedUserId = String(requestHeaders.get(VERIFIED_PRODUCT_USER_HEADER) || '').trim()
    return {
      productRoute,
      verifiedUserId: productRoute && UUID_PATTERN.test(verifiedUserId) ? verifiedUserId : null
    }
  } catch {
    return { productRoute: false, verifiedUserId: null }
  }
}

function userFromVerifiedId(id) {
  return {
    id,
    email: null,
    phone: null,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    is_anonymous: false
  }
}

function userFromClaims(claims) {
  const id = typeof claims?.sub === 'string' ? claims.sub : null
  if (!id) return null
  return {
    id,
    email: typeof claims?.email === 'string' ? claims.email : null,
    phone: typeof claims?.phone === 'string' ? claims.phone : null,
    aud: claims?.aud || 'authenticated',
    role: claims?.role || 'authenticated',
    app_metadata: claims?.app_metadata && typeof claims.app_metadata === 'object' ? claims.app_metadata : {},
    user_metadata: claims?.user_metadata && typeof claims.user_metadata === 'object' ? claims.user_metadata : {},
    is_anonymous: Boolean(claims?.is_anonymous)
  }
}

async function loadAuthenticatedUser(supabase) {
  const route = await productRouteContext()
  if (route.verifiedUserId) {
    return { user: userFromVerifiedId(route.verifiedUserId), error: null, mode: 'proxy_claims' }
  }
  if (route.productRoute) {
    const claimsResult = await supabase.auth.getClaims()
    const claimsUser = claimsResult.error ? null : userFromClaims(claimsResult.data?.claims)
    if (claimsUser) return { user: claimsUser, error: null, mode: 'claims' }
  }

  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error, mode: 'get_user' }
}

const loadCurrentUser = cache(async (selectedProfileFields = profileSelect) => {
  const sessionStartedAt = latencyStart()
  if (!isSupabaseConfigured()) return { user: null, profile: null, configured: false }

  const supabase = await createClient()
  const authStartedAt = latencyStart()
  const { user, error, mode } = await loadAuthenticatedUser(supabase)
  const authMs = elapsedMs(authStartedAt)
  recordServerLatency('page_auth_user', authMs, SERVER_LATENCY_BUDGET_MS.pageAuthUser, { mode })
  if (error || !user) {
    recordServerLatency('page_session', elapsedMs(sessionStartedAt), SERVER_LATENCY_BUDGET_MS.pageSession, { authenticated: false, auth_mode: mode })
    return { user: null, profile: null, configured: true, supabase }
  }

  const profileStartedAt = latencyStart()
  const { profile, error: profileError, created } = await ensureProfile(supabase, user, selectedProfileFields)
  const profileMs = elapsedMs(profileStartedAt)
  recordServerLatency('page_profile', profileMs, SERVER_LATENCY_BUDGET_MS.pageProfile, { recovered: Boolean(created) })
  recordServerLatency('page_session', elapsedMs(sessionStartedAt), SERVER_LATENCY_BUDGET_MS.pageSession, { authenticated: true, auth_mode: mode })
  return { user, profile, profileError, profileRecovered: Boolean(created), configured: true, supabase }
})

export async function getCurrentUser({ profileFields = profileSelect } = {}) {
  const selectedProfileFields = String(profileFields || profileSelect).trim() || profileSelect
  return loadCurrentUser(selectedProfileFields)
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
