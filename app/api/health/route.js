import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { ok: true, service: 'puddle', phase: 'authentication', authConfigured: isSupabaseConfigured() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
