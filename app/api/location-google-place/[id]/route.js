import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Google place links are unavailable.' }, { status: 503 })
  const { id } = await context.params
  if (!UUID.test(String(id || ''))) return NextResponse.json({ error: 'Place link not found.' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view place photos.' }, { status: 401 })

  const { data, error } = await supabase
    .from('location_google_places')
    .select('google_place_id')
    .eq('location_id', id)
    .eq('status', 'verified')
    .maybeSingle()
  if (error || !data?.google_place_id) return NextResponse.json({ error: 'Place link not found.' }, { status: 404, headers: { 'cache-control': 'private, no-store' } })
  return NextResponse.json({ placeId: data.google_place_id }, { headers: { 'cache-control': 'private, no-store' } })
}
