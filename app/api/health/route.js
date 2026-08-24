import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: 'puddle',
      phase: 'authentication',
      authConfigured: isSupabaseConfigured(),
      locationSearchBackend: String(process.env.GLOBAL_LOCATION_SEARCH_BACKEND || 'b2').trim().toLowerCase()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
