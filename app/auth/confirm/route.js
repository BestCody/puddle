import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'

const allowedTypes = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'])

function redirectWithMessage(url, path, kind, message) {
  const destination = new URL(path, url)
  destination.searchParams.set(kind, message)
  return NextResponse.redirect(destination)
}

export async function GET(request) {
  const url = new URL(request.url)

  if (!isSupabaseConfigured()) {
    return redirectWithMessage(
      url,
      '/signin',
      'error',
      'Accounts are temporarily unavailable. Please try again later.'
    )
  }

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')

  if (!tokenHash || !allowedTypes.has(type)) {
    return NextResponse.redirect(new URL('/auth/error', url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

  if (error) return NextResponse.redirect(new URL('/auth/error', url))

  if (type === 'email' || type === 'signup') {
    await supabase.auth.signOut({ scope: 'local' })
    return redirectWithMessage(
      url,
      '/signin',
      'success',
      'Email confirmed. You can sign in now.'
    )
  }

  if (type === 'recovery') {
    return NextResponse.redirect(new URL('/reset-password', url))
  }

  if (type === 'email_change') {
    return redirectWithMessage(
      url,
      '/change-email',
      'success',
      'Email confirmation accepted. If secure email change is enabled, confirm the message in your other inbox too.'
    )
  }

  if (type === 'invite') return NextResponse.redirect(new URL('/onboarding', url))
  return NextResponse.redirect(new URL(next, url))
}
