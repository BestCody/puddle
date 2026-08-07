import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { isSupabaseConfigured, getSupabaseEnv } from './env'

function secureOptions(options = {}) {
  return { ...options, path: '/', sameSite: options.sameSite || 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: options.httpOnly ?? false }
}

export async function updateSession(request, requestHeaders = request.headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  if (!isSupabaseConfigured()) return { response, user: null, profileState: null, profileError: null, configured: false }
  const { url, publishableKey } = getSupabaseEnv()
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: false },
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value, secureOptions(options)))
        response = NextResponse.next({ request: { headers: requestHeaders } })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, secureOptions(options)))
      }
    }
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response, user: null, profileState: null, profileError: null, configured: true }

  const profileResult = await supabase
    .from('profiles')
    .select('suspended_at,banned_at')
    .eq('id', user.id)
    .maybeSingle()

  return {
    response,
    user,
    profileState: profileResult.data || null,
    profileError: profileResult.error || null,
    configured: true
  }
}
