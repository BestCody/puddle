import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from './env'
import { supabaseServerFetch } from './server-transport'

export function createPublicClient() {
  const { url, publishableKey } = getSupabaseEnv()
  return createSupabaseClient(url, publishableKey, {
    global: { fetch: supabaseServerFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  })
}
