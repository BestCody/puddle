import { NextResponse } from 'next/server'
import { fetchFreshGooglePlacePhoto } from '@/lib/app/google-place-photo-proxy'
import { staticMediaRuntimeConfiguration } from '@/lib/app/static-media-runtime-config'
import { verifyStaticCatalogueReference } from '@/lib/app/static-catalogue-ref'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { safeSecurityError } from '@/lib/security/request'
import { string, uuid } from '@/lib/security/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function productionGooglePlacesKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || Reflect.get(process.env, 'GOOGLE_PLACES_API_KEY') || '').trim()
}

export async function GET(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Photo delivery is unavailable.' }, { status: 503 })

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

    const url = new URL(request.url)
    const referenceToken = string(url.searchParams.get('ref'), { name: 'static catalogue reference', max: 4_096 })
    const reference = verifyStaticCatalogueReference(referenceToken, { expectedId: id })
    const config = staticMediaRuntimeConfiguration()
    const apiKey = productionGooglePlacesKey()
    if (!apiKey) return NextResponse.json({ error: 'Photo delivery is unavailable.' }, { status: 503 })

    const admin = createAdminClient()
    const budget = await admin.rpc('consume_static_google_runtime_budget_v1', {
      daily_limit: config.googleDailyLimit,
      monthly_limit: config.googleMonthlyLimit
    })
    if (budget.error) throw budget.error
    if (!budget.data?.allowed) {
      return NextResponse.json({ error: 'The live photo budget is temporarily exhausted.' }, { status: 429 })
    }

    const photo = await fetchFreshGooglePlacePhoto(reference, {
      apiKey,
      minimumScore: config.googleMinimumScore,
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
      { status: error?.status || 502, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
