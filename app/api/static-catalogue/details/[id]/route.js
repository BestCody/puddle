import { NextResponse } from 'next/server'
import { fetchPrivateB2Asset } from '@/lib/app/b2-private-download'
import { fetchStaticPlaceByReference } from '@/lib/app/static-catalogue'
import { verifyStaticCatalogueReference } from '@/lib/app/static-catalogue-ref'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request, { params }) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Location details are unavailable.' }, { status: 503 })

  try {
    const { id: rawId } = await params
    const id = uuid(rawId, 'location id')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to load location details.' }, { status: 401 })

    const body = object(await readJsonLimited(request, 8_192))
    const referenceToken = string(body.ref, { name: 'static catalogue reference', max: 4_096 })
    const limited = await enforceRateLimit({
      headers: request.headers,
      userId: user.id,
      action: 'static_catalogue_details',
      weight: 1
    })
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many location detail lookups were requested. Try again shortly.' },
        { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } }
      )
    }

    const reference = verifyStaticCatalogueReference(referenceToken, { expectedId: id })
    const place = await fetchStaticPlaceByReference(reference, { fetchImpl: fetchPrivateB2Asset })
    if (!place) return NextResponse.json({ error: 'Location details were not found.' }, { status: 404 })

    return NextResponse.json({
      summary: place.summary || null,
      description_source: place.summary ? 'location_summary' : null,
      neighborhood: place.neighborhood || null,
      region_code: place.regionCode || null,
      postal_code: place.postalCode || null,
      address_public: place.addressPublic || null,
      brand_id: place.brandId || null,
      brand_name: place.brandName || null,
      website_url: place.websiteUrl || null,
      phone_public: place.phonePublic || null,
      amenities: Array.isArray(place.amenities) ? place.amenities : [],
      accessibility: place.accessibility && typeof place.accessibility === 'object' ? place.accessibility : {},
      opening_hours: place.openingHours && typeof place.openingHours === 'object' ? place.openingHours : {}
    }, {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch (error) {
    return NextResponse.json(
      { error: safeSecurityError(error, 'That catalogue detail request is invalid.') },
      { status: error?.status || 400 }
    )
  }
}
