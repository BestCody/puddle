import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'
import { authCookieOptions } from './cookie-options'

let browserClient

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  if (!browserClient) browserClient = createBrowserClient(url, publishableKey, { cookieOptions: authCookieOptions() })
  return browserClient
}
