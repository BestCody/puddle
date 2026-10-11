import { NextResponse } from 'next/server'
import { getLocationPreviews } from '@/lib/app/location-previews'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_LOCATION_IDS = 100

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Location metadata is temporarily unavailable.' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) return NextResponse.json({ error: 'Location metadata could not be loaded.' }, { status: 503 })
  if (!user) return NextResponse.json({ error: 'Sign in to view shared places.' }, { status: 401 })

  const raw = new URL(request.url).searchParams.get('ids') || ''
  const ids = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  if (ids.length > MAX_LOCATION_IDS || ids.some((id) => !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'Location metadata request is invalid.' }, { status: 400 })
  }
  if (!ids.length) return NextResponse.json({ items: [] })

  try {
    const locations = await getLocationPreviews(supabase, ids)
    return NextResponse.json({ items: locations.map(({ id, name, city, slug, cover_path }) => ({ id, name, city, slug, cover_path })) })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'Location metadata could not be loaded.') }, { status: 503 })
  }
}
