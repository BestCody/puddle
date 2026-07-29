import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const defaults = { behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false }

async function session() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Recommendation settings are unavailable.' }, { status: 503 })
  const { supabase, user } = await session()
  if (!user) return NextResponse.json({ error: 'Sign in to manage recommendations.' }, { status: 401 })
  const [{ data: preferences }, { data: flags }] = await Promise.all([
    supabase.from('recommendation_preferences').select('behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only,behavioral_reset_at,updated_at').eq('profile_id', user.id).maybeSingle(),
    supabase.from('feature_flags').select('key,enabled').in('key', ['vector_recommendations_enabled','behavioral_recommendations_enabled'])
  ])
  return NextResponse.json({ preferences: { ...defaults, ...(preferences || {}) }, featureFlags: Object.fromEntries((flags || []).map((item) => [item.key, item.enabled])) })
}

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Recommendation settings are unavailable.' }, { status: 503 })
  const { supabase, user } = await session()
  if (!user) return NextResponse.json({ error: 'Sign in to manage recommendations.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || 'save')

  if (action === 'save') {
    const { data, error } = await supabase.rpc('save_recommendation_preferences_v1', {
      behavioral: body.behavioral !== false,
      friend_activity: body.friendActivity !== false,
      vector_similarity: body.vector !== false,
      interests_only: body.explicitInterestsOnly === true
    })
    if (error) return NextResponse.json({ error: 'Recommendation preferences could not be saved.' }, { status: 400 })
    return NextResponse.json({ ok: true, preferences: data })
  }
  if (action === 'reset') {
    const { error } = await supabase.rpc('reset_recommendation_preferences_v1')
    if (error) return NextResponse.json({ error: 'Recommendation preferences could not be reset.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
  if (action === 'delete') {
    if (String(body.confirmation || '') !== 'DELETE') return NextResponse.json({ error: 'Type DELETE to confirm recommendation-data deletion.' }, { status: 400 })
    const { error } = await supabase.rpc('delete_recommendation_data_v1')
    if (error) return NextResponse.json({ error: 'Recommendation data could not be deleted.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unknown recommendation-settings action.' }, { status: 400 })
}
