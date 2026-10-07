import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('active_system_notices_v1')
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('System notices returned incomplete data.')
    return NextResponse.json({ notices: data }, { headers: privateHeaders })
  } catch (error) {
    console.error('System notices failed:', error)
    return NextResponse.json({ error: 'System notices are unavailable.' }, { status: 503, headers: privateHeaders })
  }
}
