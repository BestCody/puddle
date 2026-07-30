import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { authLinkErrorMessage, safeAuthErrorCode } from '@/lib/auth/errors'

function authFailure(url, code = 'callback_failed') {
  const safeCode = safeAuthErrorCode(code, 'callback_failed')
  const target = new URL('/signin', url)
  target.searchParams.set('error', authLinkErrorMessage(safeCode))
  target.searchParams.set('auth_error', safeCode)
  return NextResponse.redirect(target)
}

export async function GET(request) {
  const url = new URL(request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/signin?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.', url))

  const providerError = url.searchParams.get('error')
  if (providerError) {
    console.error('Supabase OAuth provider returned an error', {
      code: safeAuthErrorCode(providerError),
      description: url.searchParams.get('error_description') ? 'provided' : undefined
    })
    return authFailure(url, providerError)
  }

  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  if (!code) return authFailure(url, 'missing_auth_code')

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('Supabase auth code exchange failed', {
      code: safeAuthErrorCode(error.code || 'exchange_failed'),
      status: error.status || undefined
    })
    return authFailure(url, error.code || 'exchange_failed')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return authFailure(url, 'session_not_created')
  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return authFailure(url, 'profile_recovery_failed')

  return NextResponse.redirect(new URL(authenticatedDestination(profile, next), url))
}
