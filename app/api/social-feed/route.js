import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/user'
import { getSocialFeedSnapshot } from '@/lib/app/social-feed-data'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createTraceId, elapsedMs, latencyStart, recordSloObservation } from '@/lib/performance/server-latency'

export const dynamic = 'force-dynamic'

const SOCIAL_FEED_PROFILE_SELECT = 'id,display_name,username,avatar_path,onboarding_completed_at,suspended_at,banned_at'

function timing(name, value) {
  return `${name};dur=${Math.max(0, Number(value) || 0)}`
}

function response(body, { status = 200, traceId, startedAt, serverTiming = '' } = {}) {
  const totalMs = elapsedMs(startedAt)
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'x-puddle-trace-id': traceId,
      'server-timing': serverTiming || timing('total', totalMs)
    }
  })
}

function feedServerTiming(feed, authMs, totalMs) {
  const timings = feed?.infrastructure?.timings || {}
  return [
    timing('routeAuth', authMs),
    timing('posts', timings.postsMs),
    timing('locations', timings.locationsMs),
    timing('comments', timings.commentsMs),
    timing('states', timings.statesMs),
    timing('total', totalMs)
  ].join(',')
}

export async function GET(request) {
  const traceId = createTraceId()
  const startedAt = latencyStart()
  if (!isSupabaseConfigured()) return response({ error: 'The feed is unavailable.' }, { status: 503, traceId, startedAt })

  const authStartedAt = latencyStart()
  const current = await getCurrentUser({ profileFields: SOCIAL_FEED_PROFILE_SELECT })
  const authMs = elapsedMs(authStartedAt)
  if (!current.user) return response({ error: 'Sign in to view the feed.' }, { status: 401, traceId, startedAt, serverTiming: timing('routeAuth', authMs) })
  if (current.profileError || !current.profile) return response({ error: 'Account status could not be verified.' }, { status: 503, traceId, startedAt, serverTiming: timing('routeAuth', authMs) })
  if (!current.profile.onboarding_completed_at) return response({ error: 'Complete onboarding to view the feed.', code: 'onboarding_required' }, { status: 403, traceId, startedAt, serverTiming: timing('routeAuth', authMs) })
  if (current.profile.suspended_at || current.profile.banned_at) {
    return response({ error: current.profile.banned_at ? 'This account is banned.' : 'This account is suspended.' }, { status: 403, traceId, startedAt, serverTiming: timing('routeAuth', authMs) })
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
    return response(feed, { traceId, startedAt, serverTiming: feedServerTiming(feed, authMs, elapsedMs(startedAt)) })
  } catch (error) {
    console.error(`Social feed failed trace=${traceId}: ${error?.message || 'unknown error'}`)
    recordSloObservation('socialFeed', elapsedMs(startedAt), false, { trace_id: traceId, service: 'vercel', route: '/api/social-feed' })
    return response({ error: 'The feed could not be loaded.' }, { status: 503, traceId, startedAt })
  }
}
