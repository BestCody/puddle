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

export async function GET(request) {
  const url = new URL(request.url)
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(appUrl('/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.'))
  }

  const providerError = url.searchParams.get('error')
  if (providerError) {
    console.error('Supabase OAuth provider returned an error', {
      code: safeAuthErrorCode(providerError),
      description: url.searchParams.get('error_description') ? 'provided' : undefined
    })
    return authFailure(providerError)
  }

  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  if (!code) return authFailure('missing_auth_code')

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('Supabase auth code exchange failed', {
      code: safeAuthErrorCode(error.code || 'exchange_failed'),
      status: error.status || undefined
    })
    return authFailure(error.code || 'exchange_failed')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return authFailure('session_not_created')
  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return authFailure('profile_recovery_failed')

  return NextResponse.redirect(appUrl(authenticatedDestination(profile, next)))
}
