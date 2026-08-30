import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { normalizeOrigin, requestOrigin } from '@/lib/auth/origin'
import { safeNextPath } from '@/lib/auth/redirect'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { authLinkErrorMessage, safeAuthErrorCode } from '@/lib/auth/errors'

function appOrigin(request) {
  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://puddle.you'
  return requestOrigin(request.headers, 'http://localhost:3000')
}

function appUrl(request, path) {
  return new URL(path, appOrigin(request))
}

function authFailure(request, code = 'callback_failed') {
  const safeCode = safeAuthErrorCode(code, 'callback_failed')
  const target = appUrl(request, '/signin')
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
    return NextResponse.redirect(appUrl(request, '/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.'))
  }

  const url = new URL(request.url)
  const rawCode = url.searchParams.get('code')
  const code = exchangeableCode(rawCode)
  const providerError = knownProviderError(url.searchParams.get('error'))
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  const legalConsent = url.searchParams.get('legal_consent') === '1'

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const failureCode = providerError || (rawCode ? safeAuthErrorCode(error.code || 'exchange_failed') : 'missing_auth_code')
    console.error('Supabase auth code exchange failed', {
      code: failureCode,
      status: error.status || undefined,
      providerError: providerError || undefined
    })
    return authFailure(request, failureCode)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return authFailure(request, 'session_not_created')
  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return authFailure(request, 'profile_recovery_failed')

  if (legalConsent) {
    const acceptedAt = new Date().toISOString()
    await supabase.auth.updateUser({ data: { legal_consent_at: acceptedAt, legal_consent_version: 'current' } })
    await supabase.from('security_events').insert({
      profile_id: user.id,
      event_type: 'legal_consent_accepted',
      metadata: { terms: true, privacy: true, version: 'current', accepted_at: acceptedAt, source: 'google_signup' }
    })
  }

  return NextResponse.redirect(appUrl(request, authenticatedDestination(profile, next)))
}
