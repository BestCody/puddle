import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueReferences } from '@/lib/app/static-catalogue-materialization'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { object, string, uuid } from '@/lib/security/schema'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { normalizeDateMatchChoice, sanitizeDateMatchNote } from '@/lib/app/date-match-rules'

const MAX_ITEMS = 12

function finiteCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function safeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return {
    mood: String(value.mood || '').trim().slice(0, 80) || null,
    category: String(value.category || '').trim().slice(0, 60) || null,
    price: String(value.price || '').trim().slice(0, 12) || null,
    daypart: ['morning', 'afternoon', 'evening', 'late', 'any'].includes(value.daypart) ? value.daypart : 'any'
  }
}

function safeStaticReferences(value, locationIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowed = new Set(locationIds)
  return Object.fromEntries(Object.entries(value).flatMap(([id, token]) => {
    if (!allowed.has(id)) return []
    const clean = String(token || '').trim().slice(0, 4_096)
    return clean ? [[id, clean]] : []
  }))
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Shared location matching is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to swipe together.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'date_match_start' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many shared decks were created. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 48_000))
    const rawIds = Array.isArray(body.locationIds) ? body.locationIds.slice(0, MAX_ITEMS) : []
    const locationIds = [...new Set(rawIds.map((value) => uuid(value, 'locationId')))]
    if (locationIds.length < 2) return NextResponse.json({ error: 'Add at least two location ideas before swiping together.' }, { status: 400 })

    const profile = await supabase
      .from('profiles')
      .select('latitude,longitude')
      .eq('id', user.id)
      .maybeSingle()
    if (profile.error) throw profile.error
    const centerLatitude = finiteCoordinate(body.center?.latitude, -90, 90) ?? finiteCoordinate(profile.data?.latitude, -90, 90)
    const centerLongitude = finiteCoordinate(body.center?.longitude, -180, 180) ?? finiteCoordinate(profile.data?.longitude, -180, 180)

    const admin = createAdminClient()
    const materialization = await materializeStaticCatalogueReferences({
      admin,
      locationIds,
      references: safeStaticReferences(body.staticRefs, locationIds)
    })
    if (materialization.missing.length) {
      return NextResponse.json({ error: 'One or more catalogue locations are no longer available.' }, { status: 409 })
    }
    const resolvedByOriginal = new Map(locationIds.map((id) => [id, materialization.materialized.get(id)?.id || id]))
    const resolvedLocationIds = [...new Set(locationIds.map((id) => resolvedByOriginal.get(id)))]

    const mode = string(body.mode || 'date', { name: 'mode', choices: ['date', 'hangout'], max: 20 })
    const requestedMembers = Number(body.maxMembers)
    const maxMembers = mode === 'date' ? 2 : Math.min(8, Math.max(3, Number.isFinite(requestedMembers) ? Math.round(requestedMembers) : 4))
    const context = safeContext(body.context)

    const created = await supabase.rpc('create_shared_location_deck_v2', {
      location_ids: resolvedLocationIds,
      center_lat: centerLatitude,
      center_lng: centerLongitude,
      deck_mode: mode,
      member_limit: maxMembers,
      deck_context: context
    })
    const deckId = created.data?.deckId || created.data?.deck_id
    const token = created.data?.token
    if (created.error || !deckId || !token) return NextResponse.json({ error: 'The shared location deck could not be created.' }, { status: 400 })

    await supabase.rpc('touch_static_catalogue_materializations_v1', {
      location_ids: resolvedLocationIds,
      touch_reason: 'shared'
    })

    const choices = Array.isArray(body.choices) ? body.choices.slice(0, MAX_ITEMS) : []
    for (const rawChoice of choices) {
      try {
        const locationId = uuid(rawChoice?.locationId, 'locationId')
        if (!locationIds.includes(locationId)) continue
        const resolvedLocationId = resolvedByOriginal.get(locationId) || locationId
        const choice = normalizeDateMatchChoice(rawChoice?.choice)
        if (!choice) continue
        await supabase.rpc('record_date_match_swipe_v1', {
          target_deck: deckId,
          target_location: resolvedLocationId,
          swipe_choice: choice,
          swipe_note: sanitizeDateMatchNote(rawChoice?.note)
        })
      } catch {
        // Optional prior choices should never prevent the room from being created.
      }
    }

    const roomPath = mode === 'hangout' ? `/hangout/${token}` : `/date-match/${token}`
    const url = new URL(roomPath, request.nextUrl.origin).toString()
    return NextResponse.json({ ok: true, deckId, token, url, mode, maxMembers, roomPath })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'The shared location deck could not be created.') }, { status: error?.status || 400 })
  }
}
