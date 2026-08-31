import { ensureProfile } from './profile'

export async function authenticatePassword(supabase, email, password) {
  await supabase.auth.signOut({ scope: 'local' })

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    return { user: null, profile: null, error: error || new Error('Authentication failed.'), profileError: null }
  }

  const { profile, error: profileError } = await ensureProfile(supabase, data.user)
  return { user: data.user, profile, error: null, profileError }
}
