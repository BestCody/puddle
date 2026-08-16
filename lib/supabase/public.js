import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from './env'

export function createPublicClient() {
  const { url, publishableKey } = getSupabaseEnv()
  return createSupabaseClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  })
}
