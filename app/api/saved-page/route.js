import { NextResponse } from 'next/server'
import { getLocationPlansPage } from '@/lib/app/location-plans-data'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Sign in to view saved places.' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const cursor = String(params.get('cursor') || '').slice(0, 512)
  const category = String(params.get('category') || 'all').slice(0, 80)
  const query = String(params.get('q') || '').trim().slice(0, 100)
  try {
    const page = await getLocationPlansPage({ supabase, user }, {
      tab: 'saved', cursor, category, query, lightweightSaved: true
    })
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Saved places could not be loaded.' }, { status: 503 })
  }
}
