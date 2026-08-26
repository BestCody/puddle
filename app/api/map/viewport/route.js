import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import { filterModeratedLocationRows } from '@/lib/app/location-moderation-overlay'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
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

async function searchGlobalLocationsInViewport(input, options = {}) {
  const search = await import('@/lib/app/global-location-search')
  return search.searchGlobalLocationsInViewport(input, options)
}

const cachedPublicViewportSearch = unstable_cache(
  async (serializedViewport) => searchGlobalLocationsInViewport(JSON.parse(serializedViewport), { traceId: null }),
  ['global-location-viewport-v1'],
  { revalidate: 30, tags: ['global-location-search'] }
)

async function requireUser(traceId) {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: 'Map locations are unavailable.' }, { status: 503 }) }
  }
  const started = latencyStart()
  const requestHeaders = await headers()
  const userId = requestHeaders.get('x-puddle-product-route') === '1'
    ? String(requestHeaders.get('x-puddle-verified-user-id') || '').trim()
    : ''
  const supabase = await createClient()
  recordServerLatency('supabase.mapAuth', elapsedMs(started), SERVER_LATENCY_BUDGET_MS.pageAuthUser, {
    trace_id: traceId,
    service: 'supabase',
    operation: 'mapAuth',
    failed: !UUID_PATTERN.test(userId)
  })
  if (!UUID_PATTERN.test(userId)) return { error: NextResponse.json({ error: 'Sign in to browse map locations.' }, { status: 401 }) }
  const profileStarted = latencyStart()
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('suspended_at,banned_at')
    .eq('id', userId)
    .maybeSingle()
  recordServerLatency('supabase.mapProfile', elapsedMs(profileStarted), SERVER_LATENCY_BUDGET_MS.pageSession, {
    trace_id: traceId, service: 'supabase', operation: 'mapProfile', failed: Boolean(profileError || !profile)
  })
  if (profileError || !profile) return { error: NextResponse.json({ error: 'Account status could not be verified.' }, { status: 503 }) }
  if (profile?.suspended_at || profile?.banned_at) {
    return { error: NextResponse.json({ error: profile.banned_at ? 'This account is banned.' : 'This account is suspended.' }, { status: 403 }) }
  }
  return { user: { id: userId }, supabase }
}

function finiteParam(params, name) {
  const value = Number(params.get(name))
  if (!Number.isFinite(value)) throw new RangeError(`${name} is required.`)
  return value
}

function mapPoint(row) {
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  if (!row.id || !row.slug || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const kind = row.category || 'location'
  return {
    id: row.id,
    location_id: row.id,
    title: row.name || 'Puddle location',
    summary: row.summary || row.description || `A ${String(kind).replaceAll('_', ' ')} in ${row.neighborhood || row.city || 'this area'}.`,
    category: kind,
    neighborhood: row.neighborhood || null,
    city: row.city || null,
    latitude,
    longitude,
    href: `/plans/${row.slug}`,
    photo_url: openPhotoUrlForHash(row.primary_photo?.content_hash),
    states: ['catalogue'],
    match: null,
    plan: null
  }
}

function tracedJson(body, { status = 200, traceId, headers = {} } = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'x-puddle-trace-id': traceId,
      ...headers
    }
  })
}

export async function GET(request) {
  const traceId = createTraceId()
  const requestStarted = latencyStart()

  try {
    const params = request.nextUrl.searchParams
    const viewport = {
      north: finiteParam(params, 'north'),
      south: finiteParam(params, 'south'),
      east: finiteParam(params, 'east'),
      west: finiteParam(params, 'west'),
      zoom: Number(params.get('zoom') || 11)
    }

    // Authentication and catalogue search are independent network reads. Run them in
    // parallel so map latency is bounded by the slower backend rather than their sum.
    // Measure each promise independently; measuring after Promise.all would
    // label the slower auth read as B2 time and make production profiling
    // misleading.
    const authStarted = latencyStart()
    const authPromise = requireUser(traceId).then((value) => ({
      value,
      durationMs: elapsedMs(authStarted)
    }))
    const searchStarted = latencyStart()
    const searchPromise = cachedPublicViewportSearch(JSON.stringify(viewport)).then((value) => ({
      value,
      durationMs: elapsedMs(searchStarted)
    }))
    const [{ value: auth, durationMs: authDuration }, { value: result, durationMs: searchDuration }] = await Promise.all([
      authPromise,
      searchPromise
    ])

    if (auth.error) {
      auth.error.headers.set('x-puddle-trace-id', traceId)
      recordSloObservation('mapViewport', elapsedMs(requestStarted), false, { trace_id: traceId, service: 'vercel' })
      return auth.error
    }

    const moderationStarted = latencyStart()
    const candidates = await filterModeratedLocationRows(auth.supabase, result.candidates)
    const moderationDuration = elapsedMs(moderationStarted)
    recordSloObservation('globalLocationSearch', searchDuration, !result.timedOut, {
      trace_id: traceId,
      service: 'b2',
      search_took_ms: Math.max(0, Number(result.tookMs) || 0),
      candidate_count: candidates.length,
      timed_out: Boolean(result.timedOut)
    })

    const points = candidates.map(mapPoint).filter(Boolean)
    const totalMs = elapsedMs(requestStarted)
    recordSloObservation('mapViewport', totalMs, true, {
      trace_id: traceId,
      service: 'vercel',
      point_count: points.length
    })
    return tracedJson(
      { points, tookMs: result.tookMs, timedOut: result.timedOut, limit: result.candidateLimit },
      {
        traceId,
        headers: {
          'server-timing': `auth;dur=${authDuration}, b2Search;dur=${searchDuration}, moderation;dur=${moderationDuration}, total;dur=${totalMs}`
        }
      }
    )
  } catch (error) {
    const invalid = error instanceof RangeError
    if (!invalid) console.error(`Map viewport search failed trace=${traceId}: ${error?.message || 'unknown error'}`)
    recordSloObservation('mapViewport', elapsedMs(requestStarted), invalid, {
      trace_id: traceId,
      service: 'vercel',
      invalid_request: invalid
    })
    return tracedJson(
      { error: invalid ? error.message : 'Could not load locations in this map area.' },
      { status: invalid ? 400 : 503, traceId }
    )
  }
}
