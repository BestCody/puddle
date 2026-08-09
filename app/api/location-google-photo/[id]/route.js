import { NextResponse } from 'next/server'
import { fetchGooglePlacePhotoById } from '@/lib/app/google-place-photo-proxy'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { safeSecurityError } from '@/lib/security/request'
import { uuid } from '@/lib/security/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const HARD_GOOGLE_DAILY_LIMIT = 500
const HARD_GOOGLE_MONTHLY_LIMIT = 5_000

function boundedInteger(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function googlePhotoRuntimeConfiguration() {
  return {
    googleDailyLimit: boundedInteger(process.env.GOOGLE_PHOTO_DAILY_LIMIT, 100, { maximum: HARD_GOOGLE_DAILY_LIMIT }),
    googleMonthlyLimit: boundedInteger(process.env.GOOGLE_PHOTO_MONTHLY_LIMIT, 5_000, { maximum: HARD_GOOGLE_MONTHLY_LIMIT }),
    googleTimeoutMs: boundedInteger(process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS, 5_000, { minimum: 1_500, maximum: 15_000 })
  }
}

function productionGooglePlacesKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim()
}

function fallbackHeaders(placeId) {
  return {
    'Cache-Control': 'private, no-store',
    ...(placeId ? { 'X-Puddle-Google-Place-Id': encodeURIComponent(String(placeId)) } : {})
  }
}

export async function GET(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Photo delivery is unavailable.' }, { status: 503 })

  let fallbackPlaceId = null
  try {
    const { id: rawId } = await params
    const id = uuid(rawId, 'location id')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to view this location photo.' }, { status: 401 })

    const limited = await enforceRateLimit({
      headers: request.headers,
      userId: user.id,
      action: 'static_google_photo',
      weight: 5
    })
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many photo requests were made. Try again shortly.' },
        { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } }
      )
    }

    const admin = createAdminClient()
    const [{ data: location, error: locationError }, { data: mapping, error: mappingError }] = await Promise.all([
      admin.from('locations').select('id,status,visibility').eq('id', id).maybeSingle(),
      admin.from('location_google_places').select('google_place_id,status').eq('location_id', id).maybeSingle()
    ])
    if (locationError) throw locationError
    if (mappingError) throw mappingError
    if (!location || location.status !== 'published' || location.visibility !== 'public' || mapping?.status !== 'verified' || !mapping.google_place_id) {
      return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
    }
    fallbackPlaceId = mapping.google_place_id

    const config = googlePhotoRuntimeConfiguration()
    const apiKey = productionGooglePlacesKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Photo delivery is unavailable.' },
        { status: 503, headers: fallbackHeaders(fallbackPlaceId) }
      )
    }

    const budget = await admin.rpc('consume_static_google_runtime_budget_v1', {
      daily_limit: config.googleDailyLimit,
      monthly_limit: config.googleMonthlyLimit
    })
    if (budget.error) throw budget.error
    if (!budget.data?.allowed) {
      return NextResponse.json(
        { error: 'The live photo budget is temporarily exhausted.' },
        { status: 429, headers: fallbackHeaders(fallbackPlaceId) }
      )
    }

    const photo = await fetchGooglePlacePhotoById(mapping.google_place_id, {
      apiKey,
      timeoutMs: config.googleTimeoutMs
    })

    return new Response(photo.bytes, {
      status: 200,
      headers: {
        'Content-Type': photo.contentType,
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        ...photo.headers
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: safeSecurityError(error, 'That live photo request could not be completed.') },
      { status: error?.status || 502, headers: fallbackHeaders(fallbackPlaceId) }
    )
  }
}
