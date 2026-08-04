import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authorizeDiscoveryFeedB2Assets } from '@/lib/app/b2-feed-assets'
import { getInfrastructureDiscoveryFeedV2, recordSampledInfrastructureAnalyticsV2 } from '@/lib/app/discovery-infrastructure-v2'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Date-location discovery is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to swipe through date locations.' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,birth_date,interests,latitude,longitude,city,region,country,country_code,timezone,location_label,search_radius_km')
    .eq('id', user.id)
    .maybeSingle()
  const requestedFilters = Object.fromEntries(request.nextUrl.searchParams)
  const filters = { ...requestedFilters, kind: 'place', date: 'any' }
  const session = { supabase, user, profile: profile || {} }
  const rawFeed = await getInfrastructureDiscoveryFeedV2(session, filters)
  const feed = await authorizeDiscoveryFeedB2Assets(rawFeed)
  after(async () => {
    try {
      await recordSampledInfrastructureAnalyticsV2({ supabase, user }, feed)
    } catch (error) {
      console.warn(`Sampled discovery analytics failed: ${error.message}`)
    }
  })
  return NextResponse.json(feed, {
    headers: {
      'server-timing': `catalogue;dur=${feed.infrastructure?.timings?.catalogueMs || 0}, overlay;dur=${feed.infrastructure?.timings?.overlayMs || 0}`
    }
  })
}
