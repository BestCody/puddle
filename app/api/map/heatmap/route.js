import { NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function finiteParam(params, name) {
  const value = Number(params.get(name))
  if (!Number.isFinite(value)) throw new RangeError(`${name} is required.`)
  return value
}

export async function GET(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Map heatmap is unavailable.' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to browse the map heatmap.' }, { status: 401 })

  try {
    const params = request.nextUrl.searchParams
    const north = Math.min(85.05112878, finiteParam(params, 'north'))
    const south = Math.max(-85.05112878, finiteParam(params, 'south'))
    const east = Math.min(180, Math.max(-180, finiteParam(params, 'east')))
    const west = Math.min(180, Math.max(-180, finiteParam(params, 'west')))
    const zoom = Math.min(22, Math.max(1, Number(params.get('zoom') || 10)))

    if (south > north) throw new RangeError('Map bounds are invalid.')

    const started = performance.now()
    const { data, error } = await supabase.rpc('pass_location_heatmap_viewport_v2', {
      north,
      south,
      east,
      west,
      map_zoom: zoom,
      result_limit: 300
    })
    if (error) throw error

    const cells = (data || []).map((row) => ({
      id: row.tile_id,
      name: row.name || 'Popular area',
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      save_count: Number(row.save_count || 0)
    })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && row.save_count > 0)

    const duration = performance.now() - started
    return NextResponse.json(
      { cells },
      {
        headers: {
          'Cache-Control': 'private, max-age=20, stale-while-revalidate=60',
          'server-timing': `heatmap;dur=${Math.max(0, duration).toFixed(2)}`
        }
      }
    )
  } catch (error) {
    const invalid = error instanceof RangeError
    if (!invalid) console.error(`Map heatmap viewport failed: ${error?.message || 'unknown error'}`)
    return NextResponse.json(
      { error: invalid ? error.message : 'Could not load the heatmap in this map area.' },
      { status: invalid ? 400 : 503, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
