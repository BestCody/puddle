import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { object, uuid } from '@/lib/security/schema'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { normalizeDateMatchChoice, sanitizeDateMatchNote } from '@/lib/app/date-match-rules'

const MAX_ITEMS = 12

function finiteCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'DateMatch is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to swipe together.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'date_match_start' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many shared decks were created. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 24_000))
    const rawIds = Array.isArray(body.locationIds) ? body.locationIds.slice(0, MAX_ITEMS) : []
    const locationIds = [...new Set(rawIds.map((value) => uuid(value, 'locationId')))]
    if (locationIds.length < 2) return NextResponse.json({ error: 'Add at least two date ideas before swiping together.' }, { status: 400 })

    const created = await supabase.rpc('create_date_match_v1', {
      location_ids: locationIds,
      center_lat: finiteCoordinate(body.center?.latitude, -90, 90),
      center_lng: finiteCoordinate(body.center?.longitude, -180, 180)
    })
    const deckId = created.data?.deckId || created.data?.deck_id
    const token = created.data?.token
    if (created.error || !deckId || !token) return NextResponse.json({ error: 'The shared date deck could not be created.' }, { status: 400 })

    const choices = Array.isArray(body.choices) ? body.choices.slice(0, MAX_ITEMS) : []
    for (const rawChoice of choices) {
      try {
        const locationId = uuid(rawChoice?.locationId, 'locationId')
        if (!locationIds.includes(locationId)) continue
        const choice = normalizeDateMatchChoice(rawChoice?.choice)
        if (!choice) continue
        await supabase.rpc('record_date_match_swipe_v1', {
          target_deck: deckId,
          target_location: locationId,
          swipe_choice: choice,
          swipe_note: sanitizeDateMatchNote(rawChoice?.note)
        })
      } catch {
        // A malformed optional prior choice should not prevent the room from being created.
      }
    }

    const url = new URL(`/date-match/${token}`, request.nextUrl.origin).toString()
    return NextResponse.json({ ok: true, deckId, token, url })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'The shared date deck could not be created.') }, { status: error?.status || 400 })
  }
}
