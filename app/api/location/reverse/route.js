import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited } from '@/lib/security/request'
import { reverseGeocodeLocation } from '@/lib/app/geocoding'

export const dynamic = 'force-dynamic'

function coordinate(value, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error('Location coordinates are invalid.')
  return parsed
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use your location.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'reverse_geocode' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many location requests. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = await readJsonLimited(request, 4_000)
    const latitude = coordinate(body?.latitude, -90, 90)
    const longitude = coordinate(body?.longitude, -180, 180)
    const language = String(request.headers.get('accept-language') || 'en').slice(0, 2).toLowerCase()
    const result = await reverseGeocodeLocation(latitude, longitude, { language })
    return NextResponse.json({ result }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'We could not identify that location.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
}
