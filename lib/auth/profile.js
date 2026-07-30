export const profileSelect = 'id,display_name,username,birth_date,city,search_radius_km,bio,avatar_path,latitude,longitude,profile_visibility,activity_visibility,allow_friend_requests,allow_event_messages,onboarding_completed_at,suspended_at,role,interests'

function fallbackDisplayName(user) {
  const metadataName = String(user?.user_metadata?.display_name || '').trim()
  if (metadataName) return metadataName.slice(0, 60)
  const emailName = String(user?.email || '').split('@')[0].trim()
  return emailName.slice(0, 60) || 'Puddle person'
}

export async function ensureProfile(supabase, user) {
  if (!supabase || !user?.id) return { profile: null, error: new Error('Authenticated user is missing.') }

  const existing = await supabase.from('profiles').select(profileSelect).eq('id', user.id).maybeSingle()
  if (existing.error) return { profile: null, error: existing.error }
  if (existing.data) return { profile: existing.data, error: null, created: false }

  const created = await supabase
    .from('profiles')
    .upsert({ id: user.id, display_name: fallbackDisplayName(user) }, { onConflict: 'id' })
    .select(profileSelect)
    .single()

  return { profile: created.data || null, error: created.error || null, created: !created.error }
}

export function authenticatedDestination(profile, requestedPath = '/dashboard') {
  if (requestedPath === '/update-password') return requestedPath
  if (!profile?.onboarding_completed_at) return '/onboarding'
  return requestedPath === '/onboarding' ? '/dashboard' : requestedPath
}
