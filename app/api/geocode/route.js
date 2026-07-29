import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { geocodeAddress } from '@/lib/app/geocoding'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Location lookup is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to look up locations.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  try {
    const response = await geocodeAddress(body.address)
    if (!response.configured) return NextResponse.json({ configured: false, error: 'Automatic map lookup is temporarily unavailable. Enter coordinates manually.' }, { status: 503 })
    if (!response.result) return NextResponse.json({ error: 'No matching location was found.' }, { status: 404 })
    return NextResponse.json({ configured: true, result: response.result })
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Location lookup failed.' }, { status: 400 })
  }
}
