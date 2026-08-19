import { after, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getDiscoveryFeed } from '@/lib/app/discovery'
import { recordSampledDiscoveryAnalytics } from '@/lib/app/discovery-analytics'
import { verifyCsrf } from '@/lib/security/csrf'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
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

function continuationExcludes(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => UUID_PATTERN.test(item)))]
}

async function authenticatedSession(traceId) {
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: 'Discovery is unavailable.' }, { status: 503 }) }
  const supabaseStarted = latencyStart()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    recordServerLatency('supabase.discoveryAuth', elapsedMs(supabaseStarted), SERVER_LATENCY_BUDGET_MS.pageAuthUser, {
      trace_id: traceId,
      service: 'supabase',
      operation: 'discoveryAuth',
      failed: true
    })
    return { error: NextResponse.json({ error: 'Sign in to swipe through nearby places.' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,birth_date,interests,latitude,longitude,city,region,country,country_code,timezone,location_label,search_radius_km')
    .eq('id', user.id)
    .maybeSingle()
  recordServerLatency('supabase.discoverySession', elapsedMs(supabaseStarted), SERVER_LATENCY_BUDGET_MS.pageSession, {
    trace_id: traceId,
    service: 'supabase',
    operation: 'discoverySession'
  })
  return { session: { supabase, user, profile: profile || {}, traceId } }
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
      await recordSampledDiscoveryAnalytics({ supabase: session.supabase, user: session.user }, feed)
    } catch (error) {
      console.warn(`Sampled discovery analytics failed trace=${traceId}: ${error.message}`)
    }
  })

  const queryMs = Number(feed.infrastructure?.timings?.queryMs || 0)
  const totalMs = elapsedMs(started)
  const degraded = feed.emptyReason === 'temporarily_unavailable'
  if (String(feed.infrastructure?.requestedSource || feed.infrastructure?.source || '').startsWith('global-location')) {
    recordSloObservation('locationSearch', queryMs, !degraded && !feed.infrastructure?.searchTimedOut, {
      trace_id: traceId,
      service: 'b2',
      search_took_ms: Number(feed.infrastructure?.searchTookMs || 0),
      candidate_count: Number(feed.infrastructure?.candidates || 0),
      circuit_open: Boolean(feed.infrastructure?.circuitOpen)
    })
  }
  recordSloObservation('discovery', totalMs, !degraded, {
    trace_id: traceId,
    service: 'vercel',
    item_count: Array.isArray(feed.items) ? feed.items.length : 0,
    degraded
  })

  return withTrace(NextResponse.json(feed, {
    headers: {
      'Cache-Control': 'private, no-store',
      'server-timing': `query;dur=${queryMs}, total;dur=${totalMs}`
    }
  }), traceId)
}

export async function GET(request) {
  const traceId = createTraceId()
  const auth = await authenticatedSession(traceId)
  if (auth.error) return withTrace(auth.error, traceId)
  const requestedFilters = Object.fromEntries(request.nextUrl.searchParams)
  return discoveryResponse(auth.session, requestedFilters, [], traceId)
}

export async function POST(request) {
  const traceId = createTraceId()
  if (!verifyCsrf(request)) return withTrace(NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 }), traceId)
  const auth = await authenticatedSession(traceId)
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
