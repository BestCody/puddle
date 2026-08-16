import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { isSupabaseConfigured, getSupabaseEnv } from './env'
import { SERVER_LATENCY_BUDGET_MS, elapsedMs, latencyStart, recordServerLatency } from '@/lib/performance/server-latency'

function secureOptions(options = {}) {
  return { ...options, path: '/', sameSite: options.sameSite || 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: options.httpOnly ?? false }
}

export async function updateSession(request, requestHeaders = request.headers, { loadProfileState = false } = {}) {
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  if (!isSupabaseConfigured()) return { response, user: null, profileState: null, profileError: null, configured: false, timings: [] }
  const { url, publishableKey } = getSupabaseEnv()
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: false },
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value, secureOptions(options)))
        response = NextResponse.next({ request: { headers: requestHeaders } })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, secureOptions(options)))
      }
    }
  })

  const claimsStartedAt = latencyStart()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const claimsMs = elapsedMs(claimsStartedAt)
  recordServerLatency('proxy_claims', claimsMs, SERVER_LATENCY_BUDGET_MS.proxyClaims)
  const claims = claimsError ? null : claimsData?.claims
  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
    return {
      response,
      user: null,
      profileState: null,
      profileError: claimsError || null,
      configured: true,
      timings: [{ name: 'auth', durationMs: claimsMs }]
    }
  }

  const user = { id: userId }
  if (!loadProfileState) {
    return {
      response,
      user,
      profileState: null,
      profileError: null,
      configured: true,
      timings: [{ name: 'auth', durationMs: claimsMs }]
    }
  }

  const profileStartedAt = latencyStart()
  const profileResult = await supabase
    .from('profiles')
    .select('suspended_at,banned_at')
    .eq('id', user.id)
    .maybeSingle()
  const profileMs = elapsedMs(profileStartedAt)
  recordServerLatency('proxy_moderation_profile', profileMs, SERVER_LATENCY_BUDGET_MS.proxyModerationProfile)

  return {
    response,
    user,
    profileState: profileResult.data || null,
    profileError: profileResult.error || null,
    configured: true,
    timings: [
      { name: 'auth', durationMs: claimsMs },
      { name: 'moderation', durationMs: profileMs }
    ]
  }
}
