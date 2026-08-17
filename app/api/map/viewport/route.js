import { NextResponse } from 'next/server'
import { searchGlobalLocationsInViewport } from '@/lib/app/global-location-search'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireUser() {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: 'Map locations are unavailable.' }, { status: 503 }) }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in to browse map locations.' }, { status: 401 }) }
  return { user }
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
    photo_url: row.primary_photo?.url || null,
    states: ['catalogue'],
    match: null,
    plan: null
  }
}

export async function GET(request) {
  const auth = await requireUser()
  if (auth.error) return auth.error

  try {
    const params = request.nextUrl.searchParams
    const viewport = {
      north: finiteParam(params, 'north'),
      south: finiteParam(params, 'south'),
      east: finiteParam(params, 'east'),
      west: finiteParam(params, 'west'),
      zoom: Number(params.get('zoom') || 11)
    }
    const result = await searchGlobalLocationsInViewport(viewport)
    const points = result.candidates.map(mapPoint).filter(Boolean)
    return NextResponse.json(
      { points, tookMs: result.tookMs, timedOut: result.timedOut, limit: result.candidateLimit },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'server-timing': `opensearch;dur=${Math.max(0, Number(result.tookMs) || 0)}`
        }
      }
    )
  } catch (error) {
    const invalid = error instanceof RangeError
    if (!invalid) console.error(`Map viewport search failed: ${error?.message || 'unknown error'}`)
    return NextResponse.json(
      { error: invalid ? error.message : 'Could not load locations in this map area.' },
      { status: invalid ? 400 : 503, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
