import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { searchCities } from '@/lib/app/geocoding'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to choose a location.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'city_search' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many location searches. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  const query = String(request.nextUrl.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (query.length < 2) return NextResponse.json({ results: [] })

  try {
    const language = String(request.headers.get('accept-language') || 'en').slice(0, 2).toLowerCase()
    const results = await searchCities(query, { language, limit: 6 })
    return NextResponse.json({ results }, { headers: { 'cache-control': 'private, max-age=300' } })
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'City search is unavailable.' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
