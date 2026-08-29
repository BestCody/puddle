import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseEnv } from './env'
import { authCookieOptions, authCookieSetOptions } from './cookie-options'

export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  const cookieStore = await cookies()
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, authCookieSetOptions(options))) }
        catch { /* Server Components cannot write cookies. Proxy refreshes them instead. */ }
      }
    }
  })
}
