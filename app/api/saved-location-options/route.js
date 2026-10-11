import { NextResponse } from 'next/server'
import { savedLocationOption } from '@/lib/app/location-reference-preview'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const SAVED_OPTION_LIMIT = 50

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ items: [] }, { status: 503 })

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ items: [] }, { status: 401 })

  const requestedIds = String(new URL(request.url).searchParams.get('ids') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, SAVED_OPTION_LIMIT)

  if (requestedIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ error: 'Invalid location ID.' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase.rpc('location_saved_options_v1', {
      requested_ids: requestedIds.length ? requestedIds : null
    })
    if (error || !Array.isArray(data)) throw error || new Error('Invalid saved preview response.')
    const items = data.map(savedLocationOption)
    const byId = new Map(items.map((item) => [item.id, item]))
    return NextResponse.json({ items: requestedIds.length ? requestedIds.map((id) => byId.get(id)).filter(Boolean) : items }, {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch {
    return NextResponse.json({ items: [] }, { status: 503 })
  }
}
