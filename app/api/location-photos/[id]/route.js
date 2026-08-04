import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authorizeB2DownloadUrl, b2ObjectKeyFromUrl } from '@/lib/app/b2-private-download'
import { allowedPhotoHosts, approvedPhotoUrl } from '@/lib/app/place-photos'

export const dynamic = 'force-dynamic'

const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const MAX_PHOTO_BYTES = 10_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function fetchPhotoAsset(value, hosts, redirects = 0) {
  const url = approvedPhotoUrl(value, hosts)
  if (!url) throw new Error('Photo host is not approved.')

  const response = await fetch(url, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg',
      'User-Agent': 'Puddle/1.0 licensed place photo proxy'
    },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000)
  })

  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 2) throw new Error('Photo provider redirected too many times.')
    const location = response.headers.get('location')
    if (!location) throw new Error('Photo provider redirect was incomplete.')
    return fetchPhotoAsset(new URL(location, url).toString(), hosts, redirects + 1)
  }
  if (!response.ok) throw new Error('Photo provider did not return the image.')

  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!PHOTO_MIMES.has(mimeType)) throw new Error('Photo provider returned an unsupported file type.')
  const declaredBytes = Number(response.headers.get('content-length') || 0)
  if (declaredBytes > MAX_PHOTO_BYTES) throw new Error('Photo provider image is too large.')

  const body = await response.arrayBuffer()
  if (!body.byteLength || body.byteLength > MAX_PHOTO_BYTES) throw new Error('Photo provider image is empty or too large.')
  return { body, mimeType }
}

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Place photos are unavailable.' }, { status: 503 })
  const { id } = await context.params
  if (!UUID.test(String(id || ''))) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })

  const hosts = allowedPhotoHosts()
  if (!hosts.size) return NextResponse.json({ error: 'Place photo providers are not configured.' }, { status: 503 })

  const admin = createAdminClient()
  const { data: photo, error } = await admin
    .from('location_photo_sources')
    .select('id,location_id,remote_url,status,is_ai_generated,expires_at,cache_ttl_seconds')
    .eq('id', id)
    .maybeSingle()

  if (error || !photo || photo.status !== 'approved' || photo.is_ai_generated) {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
  }
  if (photo.expires_at && new Date(photo.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
  }

  const { data: location } = await admin
    .from('locations')
    .select('id,status,visibility')
    .eq('id', photo.location_id)
    .maybeSingle()
  if (!location || location.status !== 'published' || location.visibility !== 'public') {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
  }

  try {
    if (b2ObjectKeyFromUrl(photo.remote_url)) {
      const authorized = await authorizeB2DownloadUrl(photo.remote_url)
      return NextResponse.redirect(authorized, {
        status: 307,
        headers: {
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff'
        }
      })
    }

    const asset = await fetchPhotoAsset(photo.remote_url, hosts)
    const ttl = Math.max(0, Math.min(86_400, Number(photo.cache_ttl_seconds || 0)))
    return new NextResponse(asset.body, {
      headers: {
        'content-type': asset.mimeType,
        'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=300`,
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin'
      }
    })
  } catch {
    return NextResponse.json({ error: 'Photo could not be loaded.' }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
