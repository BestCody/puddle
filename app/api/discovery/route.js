import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getDiscoveryFeed } from '@/lib/app/discovery'
import {
  SERVER_LATENCY_BUDGET_MS,
  createTraceId,
  elapsedMs,
  latencyStart,
  recordServerLatency,
  recordSloObservation
} from '@/lib/performance/server-latency'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DISCOVERY_PROFILE_SELECT = 'latitude,longitude,search_radius_km,interests,location_label,city,suspended_at,banned_at'

function continuationExcludes(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => UUID_PATTERN.test(item)))]
}

async function authenticatedSession(traceId, requestHeaders) {
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: 'Discovery is unavailable.' }, { status: 503 }) }
  const supabaseStarted = latencyStart()
  const userId = requestHeaders.get('x-puddle-product-route') === '1'
    ? String(requestHeaders.get('x-puddle-verified-user-id') || '').trim()
    : ''
  const supabase = await createClient()
  if (!UUID_PATTERN.test(userId)) {
    recordServerLatency('supabase.discoveryAuth', elapsedMs(supabaseStarted), SERVER_LATENCY_BUDGET_MS.pageAuthUser, {
      trace_id: traceId,
      service: 'supabase',
      operation: 'discoveryAuth',
      failed: true
    })
    return { error: NextResponse.json({ error: 'Sign in to swipe through nearby places.' }, { status: 401 }) }
  }
  const user = { id: userId }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(DISCOVERY_PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()
  const authMs = elapsedMs(supabaseStarted)
  recordServerLatency('supabase.discoverySession', authMs, SERVER_LATENCY_BUDGET_MS.pageSession, {
    trace_id: traceId, service: 'supabase', operation: 'discoverySession',
    failed: Boolean(profileError || !profile)
  })
  if (profileError || !profile) return { error: NextResponse.json({ error: 'Account status could not be verified.' }, { status: 503 }) }
  if (profile?.suspended_at || profile?.banned_at) {
    return { error: NextResponse.json({ error: profile.banned_at ? 'This account is banned.' : 'This account is suspended.' }, { status: 403 }) }
  }
  return { session: { supabase, user, profile: profile || {}, traceId, authMs } }
}

function withTrace(response, traceId) {
  response.headers.set('x-puddle-trace-id', traceId)
  return response
}

async function discoveryResponse(session, filters, excludeIds = [], traceId) {
  const started = latencyStart()
  let feed
  try {
    feed = await getDiscoveryFeed(session, { ...filters, kind: 'place', date: 'any' }, { excludeIds })
  } catch (error) {
    console.error(`Discovery refresh failed trace=${traceId}: ${error?.message || 'unknown error'}`)
    recordSloObservation('discovery', elapsedMs(started), false, { trace_id: traceId, service: 'vercel' })
    return withTrace(NextResponse.json(
      { error: 'Could not load nearby places. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    ), traceId)
  }

  after(async () => {
    try {
      const { recordSampledDiscoveryAnalytics } = await import('@/lib/app/discovery-analytics')
      await recordSampledDiscoveryAnalytics({ supabase: session.supabase, user: session.user }, feed)
    } catch (error) {
      console.warn(`Sampled discovery analytics failed trace=${traceId}: ${error.message}`)
    }
  })

  const queryMs = Number(feed.infrastructure?.timings?.queryMs || 0)
  const totalMs = elapsedMs(started)
  if (String(feed.infrastructure?.source || '').startsWith('global-location')) {
    recordSloObservation('globalLocationSearch', queryMs, !feed.infrastructure?.searchTimedOut, {
      trace_id: traceId,
      service: 'b2',
      search_took_ms: Number(feed.infrastructure?.searchTookMs || 0),
      candidate_count: Number(feed.infrastructure?.candidates || 0)
    })
  }
  recordSloObservation('discovery', totalMs, true, {
    trace_id: traceId,
    service: 'vercel',
    item_count: Array.isArray(feed.items) ? feed.items.length : 0
  })

  return withTrace(NextResponse.json(feed, {
    headers: {
      'Cache-Control': 'private, no-store',
      'server-timing': `auth;dur=${Number(session.authMs || 0)}, query;dur=${queryMs}, total;dur=${totalMs}`
    }
  }), traceId)
}

export async function GET(request) {
  const traceId = createTraceId()
  const auth = await authenticatedSession(traceId, request.headers)
  if (auth.error) return withTrace(auth.error, traceId)
  const requestedFilters = Object.fromEntries(request.nextUrl.searchParams)
  return discoveryResponse(auth.session, requestedFilters, [], traceId)
}

export async function POST(request) {
  const traceId = createTraceId()
  const [{ verifyCsrf }, { readJsonLimited, safeSecurityError }] = await Promise.all([
    import('@/lib/security/csrf'),
    import('@/lib/security/request')
  ])
  if (!verifyCsrf(request)) return withTrace(NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 }), traceId)
  const auth = await authenticatedSession(traceId, request.headers)
  if (auth.error) return withTrace(auth.error, traceId)
  try {
    const body = await readJsonLimited(request, 40_000)
    const filters = body?.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {}
    return discoveryResponse(auth.session, filters, continuationExcludes(body?.excludeIds), traceId)
  } catch (error) {
    return withTrace(NextResponse.json(
      { error: safeSecurityError(error, 'That discovery continuation request is not valid.') },
      { status: error?.status || 400, headers: { 'Cache-Control': 'private, no-store' } }
    ), traceId)
  }
}
