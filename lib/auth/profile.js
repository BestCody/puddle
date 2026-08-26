export const profileSelect = 'id,display_name,username,birth_date,city,region,country,country_code,timezone,location_label,location_source,location_accuracy_m,location_updated_at,search_radius_km,bio,avatar_path,latitude,longitude,profile_visibility,activity_visibility,allow_friend_requests,allow_event_messages,onboarding_completed_at,suspended_at,banned_at,role,interests,profile_theme,appearance_theme'
const PROFILE_CACHE_TTL_MS = 2_000
const PROFILE_CACHE_MAX_ENTRIES = 1_000
const profileLoads = new Map()

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

function pruneProfileLoads(now = Date.now()) {
  for (const [userId, entry] of profileLoads) {
    if (!entry.promise && now - entry.at >= PROFILE_CACHE_TTL_MS) profileLoads.delete(userId)
  }
  while (profileLoads.size > PROFILE_CACHE_MAX_ENTRIES) {
    const oldest = profileLoads.keys().next().value
    if (oldest === undefined) break
    profileLoads.delete(oldest)
  }
}

export async function ensureProfileCached(supabase, user) {
  const userId = String(user?.id || '')
  const now = Date.now()
  pruneProfileLoads(now)
  const cached = profileLoads.get(userId)
  if (cached?.promise) return cached.promise
  if (cached && now - cached.at < PROFILE_CACHE_TTL_MS) return cached.value

  const promise = ensureProfile(supabase, user)
  profileLoads.set(userId, { at: now, promise })
  try {
    const value = await promise
    if (value.error) profileLoads.delete(userId)
    else {
      profileLoads.delete(userId)
      profileLoads.set(userId, { at: Date.now(), value })
      pruneProfileLoads()
    }
    return value
  } catch (error) {
    if (profileLoads.get(userId)?.promise === promise) profileLoads.delete(userId)
    throw error
  }
}

export function authenticatedDestination(profile, requestedPath = '/discover') {
  if (requestedPath === '/update-password') return requestedPath
  if (!profile?.onboarding_completed_at) return '/onboarding'
  return requestedPath === '/onboarding' || requestedPath === '/dashboard' ? '/discover' : requestedPath
}
