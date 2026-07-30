import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeNextPath } from '@/lib/auth/redirect'

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

  const code = url.searchParams.get('code')
  const mode = url.searchParams.get('mode')
  const next = safeNextPath(url.searchParams.get('next'), '/dashboard')

  if (!code) return NextResponse.redirect(new URL('/auth/error', url))

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) return NextResponse.redirect(new URL('/auth/error', url))

  if (mode === 'signup') {
    // Email confirmation creates a temporary session. Puddle intentionally
    // clears it so the user lands on the normal sign-in page.
    await supabase.auth.signOut({ scope: 'local' })
    return redirectWithMessage(
      url,
      '/signin',
      'success',
      'Email confirmed. You can sign in now.'
    )
  }

  if (mode === 'recovery') {
    return NextResponse.redirect(new URL('/reset-password', url))
  }

  if (mode === 'email_change') {
    return redirectWithMessage(
      url,
      '/change-email',
      'success',
      'Email confirmation accepted. If secure email change is enabled, confirm the message in your other inbox too.'
    )
  }

  return NextResponse.redirect(new URL(next, url))
}
