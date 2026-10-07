import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    {
      ok: true,
      scope: 'liveness',
      service: 'puddle',
      buildSha: process.env.PUDDLE_BUILD_SHA || null,
      phase: 'authentication',
      authConfigured: isSupabaseConfigured(),
      supabaseTransportConfigured: Boolean(process.env.SUPABASE_INTERNAL_URL),
      locationSearchBackend: 'object-store'
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
