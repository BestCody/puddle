import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { normalizeOrigin } from '@/lib/auth/origin'
import { safeNextPath } from '@/lib/auth/redirect'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { authLinkErrorMessage, safeAuthErrorCode } from '@/lib/auth/errors'

function appOrigin() {
  return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) || 'https://puddle.you'
}

function appUrl(path) {
  return new URL(path, appOrigin())
}

function authFailure(code = 'callback_failed') {
  const safeCode = safeAuthErrorCode(code, 'callback_failed')
  const target = appUrl('/signin')
  target.searchParams.set('error', authLinkErrorMessage(safeCode))
  target.searchParams.set('auth_error', safeCode)
  return NextResponse.redirect(target)
}

function knownProviderError(value) {
  switch (safeAuthErrorCode(value, '')) {
    case 'access_denied': return 'access_denied'
    case 'bad_code_verifier': return 'bad_code_verifier'
    case 'flow_state_expired': return 'flow_state_expired'
    case 'flow_state_not_found': return 'flow_state_not_found'
    default: return null
  }
}

function exchangeableCode(value) {
  const candidate = String(value || '')
  return /^[A-Za-z0-9._~-]{8,4096}$/.test(candidate) ? candidate : ''
}

export async function GET(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(appUrl('/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.'))
  }

  const url = new URL(request.url)
  const rawCode = url.searchParams.get('code')
  const code = exchangeableCode(rawCode)
  const providerError = knownProviderError(url.searchParams.get('error'))
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const failureCode = providerError || (rawCode ? safeAuthErrorCode(error.code || 'exchange_failed') : 'missing_auth_code')
    console.error('Supabase auth code exchange failed', {
      code: failureCode,
      status: error.status || undefined,
      providerError: providerError || undefined
    })
    return authFailure(failureCode)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return authFailure('session_not_created')
  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return authFailure('profile_recovery_failed')

  return NextResponse.redirect(appUrl(authenticatedDestination(profile, next)))
}
