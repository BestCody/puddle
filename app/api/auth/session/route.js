import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ authenticated: false, configured: false }, { status: 503 })
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ authenticated: false, configured: true }, { status: 401 })
  return NextResponse.json({ authenticated: true, configured: true, user: { id: user.id, email: user.email, lastSignInAt: user.last_sign_in_at } }, { headers: { 'Cache-Control': 'no-store' } })
}
