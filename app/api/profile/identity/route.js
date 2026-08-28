import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/user'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const IDENTITY_PROFILE_SELECT = 'display_name,avatar_path,onboarding_completed_at,suspended_at,banned_at'

function publicMediaUrl(session, path) {
  const value = String(path || '').trim()
  if (!value) return null
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Profile identity is unavailable.' }, { status: 503 })

  const current = await getCurrentUser({ profileFields: IDENTITY_PROFILE_SELECT })
  if (!current.user) return NextResponse.json({ error: 'Sign in to view profile identity.' }, { status: 401 })
  if (current.profileError || !current.profile) return NextResponse.json({ error: 'Profile identity could not be loaded.' }, { status: 503 })
  if (!current.profile.onboarding_completed_at) return NextResponse.json({ error: 'Complete onboarding to view profile identity.' }, { status: 403 })
  if (current.profile.suspended_at || current.profile.banned_at) return NextResponse.json({ error: 'Profile identity is unavailable.' }, { status: 403 })

  return NextResponse.json({
    displayName: current.profile.display_name || 'Puddle person',
    avatarUrl: publicMediaUrl(current, current.profile.avatar_path)
  }, {
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
