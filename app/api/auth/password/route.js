import { NextResponse } from 'next/server'
import { authenticatePassword } from '@/lib/auth/password-sign-in'
import { authenticatedDestination } from '@/lib/auth/profile'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { isValidEmail } from '@/lib/app/input-validation'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { enforceRequestSize } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function redirectWithError(request, message, next = '/discover') {
  const target = new URL(pathWithMessage('/', 'error', message, { next }), request.url)
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request) {
  let next = '/discover'

  try {
    enforceRequestSize(request, 16_000)
    const formData = await request.formData()
    const email = String(formData.get('email') || '').trim().toLowerCase()
    const password = String(formData.get('password') || '')
    next = safeNextPath(String(formData.get('next') || ''), '/discover')

    if (!isSupabaseConfigured()) return redirectWithError(request, 'Accounts are temporarily unavailable. Please try again later.', next)
    if (!isValidEmail(email)) return redirectWithError(request, 'Email or password was not accepted.', next)

    const supabase = await createClient()
    const { user, profile, error, profileError } = await authenticatePassword(supabase, email, password)
    if (error || !user) return redirectWithError(request, 'Email or password was not accepted.', next)
    if (profileError || !profile) return redirectWithError(request, 'You are signed in, but your profile could not be loaded. Please retry.', next)

    const response = NextResponse.redirect(new URL(authenticatedDestination(profile, next), request.url), 303)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return redirectWithError(request, 'We could not sign you in. Please try again.', next)
  }
}
