import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { locationPayload, validateLocation } from '@/lib/app/content-input'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function message(error, fallback) {
  const value = String(error?.message || '').trim()
  return value && !/policy|permission|schema cache|relation|supabase/i.test(value) ? value : fallback
}

async function savePrivateDetail(supabase, id, exactAddress, userId) {
  if (exactAddress) {
    return supabase.from('location_private_details').upsert({
      location_id: id,
      exact_address: exactAddress,
      updated_by: userId,
      updated_at: new Date().toISOString()
    })
  }
  return supabase.from('location_private_details').delete().eq('location_id', id)
}

export async function POST(request, context) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
  const { kind } = await context.params
  if (kind !== 'place') return NextResponse.json({ error: 'Unknown draft type.' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save drafts.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'draft_autosave' })
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Drafts are being saved too quickly. Pause briefly and try again.' }, {
      status: 429,
      headers: { 'retry-after': String(limited.retryAfter || 60) }
    })
  }

  let input
  try {
    input = await readJsonLimited(request, 64_000)
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'The draft could not be read.') }, { status: error?.status || 400 })
  }

  const id = String(input.id || '').trim()
  let existing = null
  if (id) {
    const result = await supabase.from('location_submissions').select('*').eq('id', id).maybeSingle()
    existing = result.data
    if (!existing) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 })
  }

  const payload = locationPayload(input, user.id, existing)
  const errors = validateLocation(payload)
  if (errors.length) return NextResponse.json({ saved: false, waiting: true, error: errors[0] }, { status: 422 })

  const privateAddress = payload.private_address
  const writable = { ...payload }
  delete writable.private_address
  if (existing) {
    delete writable.created_by
    delete writable.slug
  }
  const query = existing
    ? supabase.from('location_submissions').update(writable).eq('id', id).select('id,slug,status,autosaved_at').single()
    : supabase.from('location_submissions').insert(writable).select('id,slug,status,autosaved_at').single()
  const { data, error } = await query
  if (error || !data) return NextResponse.json({ error: message(error, 'Draft could not be saved.') }, { status: 400 })

  const privateResult = await savePrivateDetail(supabase, data.id, privateAddress, user.id)
  if (privateResult.error) {
    return NextResponse.json({ error: 'The draft saved, but its private address could not be secured.' }, { status: 400 })
  }
  return NextResponse.json({ saved: true, draft: data })
}
