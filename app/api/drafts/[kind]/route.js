import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { eventPayload, locationPayload, validateEvent, validateLocation } from '@/lib/app/content-input'

export const dynamic = 'force-dynamic'

function message(error, fallback) {
  const value = String(error?.message || '').trim()
  return value && !/policy|permission|schema cache|relation|supabase/i.test(value) ? value : fallback
}

export async function POST(request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
  const { kind } = await context.params
  if (!['event', 'place'].includes(kind)) return NextResponse.json({ error: 'Unknown draft type.' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save drafts.' }, { status: 401 })

  let input
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'The draft could not be read.' }, { status: 400 })
  }

  const id = String(input.id || '').trim()
  const table = kind === 'event' ? 'events' : 'locations'
  let existing = null
  if (id) {
    const result = await supabase.from(table).select('*').eq('id', id).maybeSingle()
    existing = result.data
    if (!existing) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 })
  }

  const payload = kind === 'event' ? eventPayload(input, user.id, existing) : locationPayload(input, user.id, existing)
  const errors = kind === 'event' ? validateEvent(payload) : validateLocation(payload)
  if (errors.length) return NextResponse.json({ saved: false, waiting: true, error: errors[0] }, { status: 422 })

  const writable = { ...payload }
  if (existing) {
    delete writable.created_by
    delete writable.slug
  }
  const query = existing
    ? supabase.from(table).update(writable).eq('id', id).select('id,slug,status,autosaved_at').single()
    : supabase.from(table).insert(writable).select('id,slug,status,autosaved_at').single()
  const { data, error } = await query
  if (error || !data) return NextResponse.json({ error: message(error, 'Draft could not be saved.') }, { status: 400 })

  return NextResponse.json({ saved: true, draft: data })
}
