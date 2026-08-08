import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { findStaticOpenPhotoCandidates, downloadStaticOpenPhotoCandidate } from '@/lib/app/static-open-photo-provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { safeSecurityError } from '@/lib/security/request'
import { uuid } from '@/lib/security/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const OPEN_PROVIDERS = new Set(['wikimedia-commons', 'mapillary', 'kartaview'])

function locationPayload(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    city: row.city,
    region: row.region,
    country: row.country,
    countryCode: row.country_code,
    addressPublic: row.address_public,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude)
  }
}

async function normalizedJpeg(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
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
      action: 'static_media_resolve',
      weight: 2
    })
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many photo requests were made. Try again shortly.' },
        { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } }
      )
    }

    const admin = createAdminClient()
    const { data: location, error: locationError } = await admin
      .from('locations')
      .select('id,name,kind,city,region,country,country_code,address_public,latitude,longitude,status,visibility')
      .eq('id', id)
      .maybeSingle()
    if (locationError) throw locationError
    if (!location || location.status !== 'published' || location.visibility !== 'public') {
      return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
    }

    const { data: sources, error: sourceError } = await admin
      .from('location_photo_sources')
      .select('provider,external_photo_id,status,is_ai_generated,expires_at,is_primary,sort_order,verified_at')
      .eq('location_id', id)
      .eq('status', 'approved')
      .eq('is_ai_generated', false)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('verified_at', { ascending: false })
      .limit(8)
    if (sourceError) throw sourceError

    const now = Date.now()
    const approved = (sources || []).find((source) =>
      OPEN_PROVIDERS.has(String(source.provider || '')) &&
      (!source.expires_at || new Date(source.expires_at).getTime() > now)
    )
    if (!approved) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })

    const providerResult = await findStaticOpenPhotoCandidates(locationPayload(location), { maxCandidatesPerProvider: 10 })
    const candidate = (providerResult.candidates || []).find((entry) =>
      String(entry.provider || '') === String(approved.provider || '') &&
      String(entry.externalId || '') === String(approved.external_photo_id || '')
    )
    if (!candidate) return NextResponse.json({ error: 'The approved open photo is temporarily unavailable.' }, { status: 404 })

    const sourceBytes = await downloadStaticOpenPhotoCandidate(candidate)
    const body = await normalizedJpeg(sourceBytes)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'X-Puddle-Open-Provider': String(candidate.provider || '')
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: safeSecurityError(error, 'That open photo request could not be completed.') },
      { status: error?.status || 502, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
