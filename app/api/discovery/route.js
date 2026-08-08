import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getRelationalDiscoveryFeed } from '@/lib/app/discovery-relational-fallback'
import { recordSampledDiscoveryAnalytics } from '@/lib/app/discovery-analytics'
import { verifyCsrf } from '@/lib/security/csrf'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

const MAX_CONTINUATION_EXCLUDES = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function continuationExcludes(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => UUID_PATTERN.test(item)))].slice(0, MAX_CONTINUATION_EXCLUDES)
}

async function authenticatedSession() {
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: 'Date-location discovery is unavailable.' }, { status: 503 }) }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in to swipe through date locations.' }, { status: 401 }) }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,birth_date,interests,latitude,longitude,city,region,country,country_code,timezone,location_label,search_radius_km')
    .eq('id', user.id)
    .maybeSingle()
  return { session: { supabase, user, profile: profile || {} } }
}

async function discoveryResponse(session, filters, excludeIds = []) {
  let feed
  try {
    feed = await getRelationalDiscoveryFeed(session, { ...filters, kind: 'place', date: 'any' }, { excludeIds })
  } catch (error) {
    console.error(`Discovery refresh failed: ${error?.message || 'unknown error'}`)
    return NextResponse.json(
      { error: 'Could not load nearby places. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }

  after(async () => {
    try {
      await recordSampledDiscoveryAnalytics({ supabase: session.supabase, user: session.user }, feed)
    } catch (error) {
      console.warn(`Sampled discovery analytics failed: ${error.message}`)
    }
  })
  return NextResponse.json(feed, {
    headers: {
      'Cache-Control': 'private, no-store',
      'server-timing': `catalogue;dur=${feed.infrastructure?.timings?.catalogueMs || 0}, overlay;dur=${feed.infrastructure?.timings?.overlayMs || 0}`
    }
  })
}

export async function GET(request) {
  const auth = await authenticatedSession()
  if (auth.error) return auth.error
  const requestedFilters = Object.fromEntries(request.nextUrl.searchParams)
  return discoveryResponse(auth.session, requestedFilters)
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  const auth = await authenticatedSession()
  if (auth.error) return auth.error
  try {
    const body = await readJsonLimited(request, 40_000)
    const filters = body?.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {}
    return discoveryResponse(auth.session, filters, continuationExcludes(body?.excludeIds))
  } catch (error) {
    return NextResponse.json(
      { error: safeSecurityError(error, 'That discovery continuation request is not valid.') },
      { status: error?.status || 400, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
