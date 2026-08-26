import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/user'
import { getSocialFeedSnapshot } from '@/lib/app/social-feed-data'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createTraceId, elapsedMs, latencyStart, recordSloObservation } from '@/lib/performance/server-latency'

export const dynamic = 'force-dynamic'

function response(body, { status = 200, traceId, startedAt } = {}) {
  const totalMs = elapsedMs(startedAt)
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'x-puddle-trace-id': traceId,
      'server-timing': `total;dur=${totalMs}`
    }
  })
}

export async function GET(request) {
  const traceId = createTraceId()
  const startedAt = latencyStart()
  if (!isSupabaseConfigured()) return response({ error: 'The feed is unavailable.' }, { status: 503, traceId, startedAt })

  const current = await getCurrentUser()
  if (!current.user) return response({ error: 'Sign in to view the feed.' }, { status: 401, traceId, startedAt })
  if (current.profileError || !current.profile) return response({ error: 'Account status could not be verified.' }, { status: 503, traceId, startedAt })
  if (!current.profile.onboarding_completed_at) return response({ error: 'Complete onboarding to view the feed.' }, { status: 403, traceId, startedAt })
  if (current.profile.suspended_at || current.profile.banned_at) {
    return response({ error: current.profile.banned_at ? 'This account is banned.' : 'This account is suspended.' }, { status: 403, traceId, startedAt })
  }

  const params = request.nextUrl.searchParams
  try {
    const feed = await getSocialFeedSnapshot({ ...current, traceId }, params.get('q') || '', {
      beforeCreatedAt: params.get('before') || null,
      beforePostId: params.get('beforeId') || null
    })
    recordSloObservation('socialFeed', elapsedMs(startedAt), true, {
      trace_id: traceId,
      service: 'vercel',
      route: '/api/social-feed',
      item_count: Array.isArray(feed.items) ? feed.items.length : 0
    })
    return response(feed, { traceId, startedAt })
  } catch (error) {
    console.error(`Social feed failed trace=${traceId}: ${error?.message || 'unknown error'}`)
    recordSloObservation('socialFeed', elapsedMs(startedAt), false, { trace_id: traceId, service: 'vercel', route: '/api/social-feed' })
    return response({ error: 'The feed could not be loaded.' }, { status: 503, traceId, startedAt })
  }
}
