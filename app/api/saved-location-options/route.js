import { NextResponse } from 'next/server'
import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const SAVED_OPTION_LIMIT = 50

function optionShape(row) {
  return {
    id: row.id,
    name: row.name || 'Saved place',
    title: row.name || 'Saved place',
    slug: row.slug || null,
    city: row.city || row.region || row.country || null,
    neighborhood: row.neighborhood || null,
    category: row.category || row.kind || 'place'
  }
}

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

  let ids = requestedIds
  if (requestedIds.length) {
    const { data: ownedRows, error } = await supabase
      .from('user_content_states')
      .select('location_id')
      .eq('profile_id', user.id)
      .eq('state', 'saved')
      .in('location_id', requestedIds)
    if (error) return NextResponse.json({ items: [] }, { status: 503 })
    const owned = new Set((ownedRows || []).map((row) => String(row.location_id)))
    ids = requestedIds.filter((id) => owned.has(id))
  } else {
    const { data: savedRows, error } = await supabase
      .from('user_content_states')
      .select('location_id,created_at')
      .eq('profile_id', user.id)
      .eq('state', 'saved')
      .not('location_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(SAVED_OPTION_LIMIT)
    if (error || !savedRows?.length) return NextResponse.json({ items: [] })
    ids = [...new Set(savedRows.map((row) => String(row.location_id || '')).filter(Boolean))]
  }

  if (!ids.length) return NextResponse.json({ items: [] })

  try {
    const locations = await getGlobalLocationsByIds(ids)
    const byId = new Map(locations.map((row) => [String(row.id), optionShape(row)]))
    return NextResponse.json({ items: ids.map((id) => byId.get(id)).filter(Boolean) })
  } catch {
    return NextResponse.json({ items: [] }, { status: 503 })
  }
}
