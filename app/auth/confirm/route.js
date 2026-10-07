import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'
import { authenticatedDestination, ensureProfile } from '@/lib/auth/profile'
import { authLinkErrorMessage, safeAuthErrorCode } from '@/lib/auth/errors'
import { siteUrl } from '@/lib/auth/origin'

const allowedTypes = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'])

function confirmationFailure(request, code = 'confirmation_failed') {
  const safeCode = safeAuthErrorCode(code, 'confirmation_failed')
  const target = siteUrl(request.headers, '/landing.html')
  target.searchParams.set('error', authLinkErrorMessage(safeCode, 'That authentication link could not be verified. Please request a new one.'))
  target.searchParams.set('auth_error', safeCode)
  return NextResponse.redirect(target)
}

export async function GET(request) {
  const url = new URL(request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(siteUrl(request.headers, '/landing.html?error=Accounts+are+temporarily+unavailable.+Please+try+again+later.'))

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')
  if (!tokenHash || !allowedTypes.has(type)) return confirmationFailure(request, 'invalid_confirmation_link')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) {
    console.error('Supabase auth confirmation failed', {
      code: safeAuthErrorCode(error.code || 'confirmation_failed'),
      status: error.status || undefined,
      type
    })
    return confirmationFailure(request, error.code || 'confirmation_failed')
  }

  const user = data.user || (await supabase.auth.getUser()).data.user
  if (!user) return confirmationFailure(request, 'session_not_created')
  const { profile, error: profileError } = await ensureProfile(supabase, user)
  if (profileError) return confirmationFailure(request, 'profile_recovery_failed')

  return NextResponse.redirect(siteUrl(request.headers, authenticatedDestination(profile, next)))
}
