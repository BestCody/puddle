import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { isSupabaseConfigured, getSupabaseEnv } from './env'

export async function updateSession(request) {
  let response = NextResponse.next({ request })
  if (!isSupabaseConfigured()) return { response, user: null, configured: false }

  const { url, publishableKey } = getSupabaseEnv()
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      }
    }
  })

  const { data: { user } } = await supabase.auth.getUser()
  return { response, user, configured: true }
}
