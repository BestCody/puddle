import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { object, string, uuid } from '@/lib/security/schema'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { normalizeDateMatchChoice, sanitizeDateMatchNote } from '@/lib/app/date-match-rules'

const ACTIONS = ['swipe', 'schedule', 'feedback']

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'DateMatch is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to update this DateMatch.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'date_match_action' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many DateMatch actions were sent. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 12_000))
    const action = string(body.action, { name: 'action', choices: ACTIONS, max: 20 })
    const deckId = uuid(body.deckId, 'deckId')
    const locationId = uuid(body.locationId, 'locationId')

    if (action === 'swipe') {
      const choice = normalizeDateMatchChoice(body.choice)
      if (!choice) return NextResponse.json({ error: 'Choose Pass, Save, or Perfect Pick.' }, { status: 400 })
      const result = await supabase.rpc('record_date_match_swipe_v1', {
        target_deck: deckId,
        target_location: locationId,
        swipe_choice: choice,
        swipe_note: sanitizeDateMatchNote(body.note)
      })
      if (result.error) return NextResponse.json({ error: 'That choice could not be saved.' }, { status: 400 })
      return NextResponse.json({ ok: true, result: result.data })
    }

    if (action === 'schedule') {
      const plannedFor = new Date(String(body.plannedFor || ''))
      if (Number.isNaN(plannedFor.getTime())) return NextResponse.json({ error: 'Choose a valid date and time.' }, { status: 400 })
      const result = await supabase.rpc('schedule_date_match_v1', {
        target_deck: deckId,
        target_location: locationId,
        planned_time: plannedFor.toISOString()
      })
      if (result.error) return NextResponse.json({ error: 'That date could not be scheduled.' }, { status: 400 })
      return NextResponse.json({ ok: true, result: result.data })
    }

    const happened = body.happened === true
    const rating = happened ? string(body.rating, { name: 'rating', choices: ['great', 'okay', 'not_for_us'], max: 20 }) : null
    const result = await supabase.rpc('record_date_match_feedback_v1', {
      target_deck: deckId,
      target_location: locationId,
      did_happen: happened,
      date_rating: rating
    })
    if (result.error) return NextResponse.json({ error: 'That feedback could not be saved.' }, { status: 400 })
    return NextResponse.json({ ok: true, result: result.data })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That DateMatch action is not valid.') }, { status: error?.status || 400 })
  }
}
