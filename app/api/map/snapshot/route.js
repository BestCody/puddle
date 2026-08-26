import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/user'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createTraceId, elapsedMs, latencyStart, recordSloObservation } from '@/lib/performance/server-latency'

export const dynamic = 'force-dynamic'

function response(body, { status = 200, traceId, startedAt, serverTiming = '' } = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'x-puddle-trace-id': traceId,
      'server-timing': serverTiming || `total;dur=${elapsedMs(startedAt)}`
    }
  })
}

export async function GET() {
  const traceId = createTraceId()
  const startedAt = latencyStart()
  if (!isSupabaseConfigured()) {
    return response({ error: 'The map is unavailable.' }, { status: 503, traceId, startedAt })
  }

  const current = await getCurrentUser()
  if (!current.user) return response({ error: 'Sign in to view your map.' }, { status: 401, traceId, startedAt })
  if (current.profileError || !current.profile) {
    return response({ error: 'Account status could not be verified.' }, { status: 503, traceId, startedAt })
  }
  if (!current.profile.onboarding_completed_at) {
    return response({ error: 'Complete onboarding to view your map.', code: 'onboarding_required' }, { status: 403, traceId, startedAt })
  }
  if (current.profile.suspended_at || current.profile.banned_at) {
    return response({
      error: current.profile.banned_at ? 'This account is banned.' : 'This account is suspended.'
    }, { status: 403, traceId, startedAt })
  }

  try {
    const snapshotStartedAt = latencyStart()
    const snapshot = await getLocationMapSnapshot({ ...current, traceId })
    const snapshotMs = elapsedMs(snapshotStartedAt)
    const totalMs = elapsedMs(startedAt)
    recordSloObservation('mapSnapshot', totalMs, true, {
      trace_id: traceId,
      service: 'vercel',
      point_count: Array.isArray(snapshot.points) ? snapshot.points.length : 0
    })
    return response({
      ...snapshot,
      self: {
        avatar_url: current.profile.avatar_path || null,
        display_name: current.profile.display_name || 'Puddle person'
      }
    }, {
      traceId,
      startedAt,
      serverTiming: `snapshot;dur=${snapshotMs},total;dur=${totalMs}`
    })
  } catch (error) {
    console.error(`Map snapshot failed trace=${traceId}: ${error?.message || 'unknown error'}`)
    const totalMs = elapsedMs(startedAt)
    recordSloObservation('mapSnapshot', totalMs, false, { trace_id: traceId, service: 'vercel' })
    return response({ error: 'The map could not be loaded.' }, { status: 503, traceId, startedAt })
  }
}
