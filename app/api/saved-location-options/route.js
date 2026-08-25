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

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ items: [] }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ items: [] }, { status: 401 })

  const { data: savedRows, error } = await supabase
    .from('user_content_states')
    .select('location_id,created_at')
    .eq('profile_id', user.id)
    .eq('state', 'saved')
    .not('location_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(SAVED_OPTION_LIMIT)

  if (error || !savedRows?.length) return NextResponse.json({ items: [] })

  const ids = [...new Set(savedRows.map((row) => String(row.location_id || '')).filter(Boolean))]
  if (!ids.length) return NextResponse.json({ items: [] })

  try {
    const locations = await getGlobalLocationsByIds(ids)
    const byId = new Map(locations.map((row) => [String(row.id), optionShape(row)]))
    const items = ids.map((id) => byId.get(id)).filter(Boolean)
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [] }, { status: 503 })
  }
}
