export const profileSelect = 'id,display_name,username,birth_date,city,region,country,country_code,timezone,location_label,location_source,location_accuracy_m,location_updated_at,search_radius_km,bio,avatar_path,latitude,longitude,profile_visibility,activity_visibility,allow_friend_requests,allow_event_messages,onboarding_completed_at,suspended_at,banned_at,role,interests,profile_theme,appearance_theme'

const PROFILE_READ_RETRY_DELAY_MS = 50

function isTransientProfileError(error) {
  const status = Number(error?.status)
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true

  const code = String(error?.code || '').toUpperCase()
  if (/^08/.test(code) || ['53300', '57014', '57P01', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code)) return true

  const message = String(error?.message || '').toLowerCase()
  return /fetch failed|network|timed out|timeout|econnreset|econnrefused|socket hang up/.test(message)
}

function fallbackDisplayName(user) {
  const metadataName = String(user?.user_metadata?.display_name || '').trim()
  if (metadataName) return metadataName.slice(0, 60)
  const emailName = String(user?.email || '').split('@')[0].trim()
  return emailName.slice(0, 60) || 'Puddle person'
}

export async function ensureProfile(supabase, user, selection = profileSelect) {
  if (!supabase || !user?.id) return { profile: null, error: new Error('Authenticated user is missing.') }

  const fields = String(selection || profileSelect).trim() || profileSelect
  const readProfile = () => supabase.from('profiles').select(fields).eq('id', user.id).maybeSingle()
  let existing = await readProfile()
  if (existing.error && isTransientProfileError(existing.error)) {
    await new Promise((resolve) => setTimeout(resolve, PROFILE_READ_RETRY_DELAY_MS))
    existing = await readProfile()
  }
  if (existing.error) return { profile: null, error: existing.error }
  if (existing.data) return { profile: existing.data, error: null, created: false }

  const created = await supabase
    .from('profiles')
    .upsert({ id: user.id, display_name: fallbackDisplayName(user) }, { onConflict: 'id' })
    .select(fields)
    .single()

  return { profile: created.data || null, error: created.error || null, created: !created.error }
}

export function authenticatedDestination(profile, requestedPath = '/discover') {
  if (requestedPath === '/update-password') return requestedPath
  if (!profile?.onboarding_completed_at) return '/onboarding'
  return requestedPath === '/onboarding' || requestedPath === '/dashboard' ? '/discover' : requestedPath
}
