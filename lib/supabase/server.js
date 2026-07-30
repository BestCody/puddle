import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseEnv } from './env'

function secureOptions(options = {}) {
  return { ...options, path: '/', sameSite: options.sameSite || 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: options.httpOnly ?? false }
}

export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  const cookieStore = await cookies()
  return createServerClient(url, publishableKey, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: false },
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, secureOptions(options))) }
        catch { /* Server Components cannot write cookies. Proxy refreshes them instead. */ }
      }
    }
  })
}
