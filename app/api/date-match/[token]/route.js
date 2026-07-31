import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { getDateMatchSnapshot } from '@/lib/app/date-match'

export const dynamic = 'force-dynamic'

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'DateMatch is unavailable.' }, { status: 503 })
  const { token } = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view this DateMatch.' }, { status: 401 })
  const snapshot = await getDateMatchSnapshot({ supabase, user }, token)
  if (!snapshot) return NextResponse.json({ error: 'DateMatch not found.' }, { status: 404, headers: { 'cache-control': 'private, no-store' } })
  return NextResponse.json(snapshot, { headers: { 'cache-control': 'private, no-store' } })
}
