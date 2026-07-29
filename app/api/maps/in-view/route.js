import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getMapContent } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ items: [] })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use the map.' }, { status: 401 })
  const items = await getMapContent({ supabase, user }, Object.fromEntries(request.nextUrl.searchParams))
  return NextResponse.json({ items })
}
