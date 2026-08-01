import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { eventPayload, locationPayload, validateEvent, validateLocation } from '@/lib/app/content-input'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { legacySystemsEnabled } from '@/lib/product-vision'

export const dynamic = 'force-dynamic'

function message(error, fallback) {
  const value = String(error?.message || '').trim()
  return value && !/policy|permission|schema cache|relation|supabase/i.test(value) ? value : fallback
}

async function savePrivateDetail(supabase, kind, id, exactAddress, userId) {
  const table = kind === 'event' ? 'event_private_details' : 'location_private_details'
  const key = kind === 'event' ? 'event_id' : 'location_id'
  if (exactAddress) return supabase.from(table).upsert({ [key]: id, exact_address: exactAddress, updated_by: userId, updated_at: new Date().toISOString() })
  return supabase.from(table).delete().eq(key, id)
}

export async function POST(request, context) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
  const { kind } = await context.params
  if (!['event', 'place'].includes(kind)) return NextResponse.json({ error: 'Unknown draft type.' }, { status: 404 })
  if (kind === 'event' && !legacySystemsEnabled()) return NextResponse.json({ error: 'Event creation is disabled in the location-first product.' }, { status: 410 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save drafts.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'draft_autosave' })
  if (!limited.allowed) return NextResponse.json({ error: 'Drafts are being saved too quickly. Pause briefly and try again.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  let input
  try {
    input = await readJsonLimited(request, 64_000)
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'The draft could not be read.') }, { status: error?.status || 400 })
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

  const privateAddress = payload.private_address
  const writable = { ...payload }
  delete writable.private_address
  if (existing) {
    delete writable.created_by
    delete writable.slug
  }
  const query = existing
    ? supabase.from(table).update(writable).eq('id', id).select('id,slug,status,autosaved_at').single()
    : supabase.from(table).insert(writable).select('id,slug,status,autosaved_at').single()
  const { data, error } = await query
  if (error || !data) return NextResponse.json({ error: message(error, 'Draft could not be saved.') }, { status: 400 })
  const privateResult = await savePrivateDetail(supabase, kind, data.id, privateAddress, user.id)
  if (privateResult.error) return NextResponse.json({ error: 'The draft saved, but its private address could not be secured.' }, { status: 400 })

  return NextResponse.json({ saved: true, draft: data })
}
