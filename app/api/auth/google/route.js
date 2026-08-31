import { NextResponse } from 'next/server'
import { startGoogleOAuth } from '@/lib/auth/google-oauth'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { enforceRequestSize } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function redirectWithError(request, message, next = '/discover', extra = {}) {
  const target = new URL(pathWithMessage('/', 'error', message, { next, ...extra }), request.url)
  const response = NextResponse.redirect(target, 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request) {
  const next = safeNextPath(new URL(request.url).searchParams.get('next'), '/discover')
  if (!isSupabaseConfigured()) return redirectWithError(request, 'Accounts are temporarily unavailable. Please try again later.', next)

  try {
    const supabase = await createClient()
    const { data, error } = await startGoogleOAuth(supabase, request.headers, next)
    if (error || !data?.url) return redirectWithError(request, 'Google sign-in is temporarily unavailable. Please try again.', next)

    const response = NextResponse.redirect(data.url, 302)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return redirectWithError(request, 'Google sign-in is temporarily unavailable. Please try again.', next)
  }
}

export async function POST(request) {
  try {
    enforceRequestSize(request, 16_000)
    const formData = await request.formData()
    const provider = String(formData.get('provider') || '').trim()
    const signupIntent = String(formData.get('signup_intent') || '').trim() === '1'
    const termsAccepted = String(formData.get('terms_accepted') || '').trim() === 'yes'

    if (provider !== 'google' || !signupIntent) return redirectWithError(request, 'That sign-in option is not supported.', '/discover', { mode: 'signup' })
    if (!termsAccepted) return redirectWithError(request, 'Agree to the Terms and Privacy Policy before creating an account.', '/discover', { mode: 'signup' })
    if (!isSupabaseConfigured()) return redirectWithError(request, 'Accounts are temporarily unavailable. Please try again later.', '/discover', { mode: 'signup' })

    const supabase = await createClient()
    const { data, error } = await startGoogleOAuth(supabase, request.headers, '/onboarding', true)
    if (error || !data?.url) return redirectWithError(request, 'Google sign-up is temporarily unavailable. Please try again.', '/discover', { mode: 'signup' })

    const response = NextResponse.redirect(data.url, 302)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return redirectWithError(request, 'Google sign-up is temporarily unavailable. Please try again.', '/discover', { mode: 'signup' })
  }
}
