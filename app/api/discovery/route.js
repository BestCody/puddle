import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Date-location discovery is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to swipe through date locations.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('id,birth_date,interests,latitude,longitude,search_radius_km').eq('id', user.id).maybeSingle()
  const requestedFilters = Object.fromEntries(request.nextUrl.searchParams)
  const filters = { ...requestedFilters, kind: 'place', date: 'any' }
  const feed = await getDiscoveryFeed({ supabase, user, profile: profile || {} }, filters)
  await logDiscoveryImpressions({ supabase, user }, feed)
  return NextResponse.json(feed)
}
