import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { geocodeAddress } from '@/lib/app/geocoding'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string } from '@/lib/security/schema'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Location lookup is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to look up locations.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'geocode_lookup' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many location lookups. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 8_000))
    const address = string(body.address, { name: 'address', min: 3, max: 500 })
    const response = await geocodeAddress(address)
    if (!response.configured) return NextResponse.json({ configured: false, error: 'Automatic map lookup is temporarily unavailable. Enter coordinates manually.' }, { status: 503 })
    if (!response.result) return NextResponse.json({ error: 'No matching location was found.' }, { status: 404 })
    return NextResponse.json({ configured: true, result: response.result })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'Location lookup failed.') }, { status: error?.status || 400 })
  }
}
