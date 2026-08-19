import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

let browserClient

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  if (!browserClient) browserClient = createBrowserClient(url, publishableKey)
  return browserClient
}
