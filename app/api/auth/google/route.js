import { NextResponse } from 'next/server'
import { startGoogleOAuth } from '@/lib/auth/google-oauth'
import { pathWithMessage, safeNextPath } from '@/lib/auth/redirect'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function redirectWithError(request, message, next = '/discover') {
  const target = new URL(pathWithMessage('/', 'error', message, { next }), request.url)
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
