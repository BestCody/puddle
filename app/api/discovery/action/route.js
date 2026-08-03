import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueLocations } from '@/lib/app/static-catalogue-materialization'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'
import { legacySystemsEnabled } from '@/lib/product-vision'

const DISCOVERY_ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo'])
const RECOMMENDATION_ACTIONS = new Set([...DISCOVERY_ACTIONS, 'opened', 'perfect'])
const KINDS = legacySystemsEnabled() ? ['event', 'place'] : ['place']

function contextEvent(requestedAction, action) {
  if (requestedAction === 'perfect') return 'perfect'
  if (action === 'dismissed') return 'pass'
  if (action === 'saved' || action === 'interested') return 'save'
  if (action === 'visited') return 'visited'
  if (action === 'opened') return 'opened'
  return null
}

function safeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { mode: 'solo', category: null, payload: {} }
  const mode = ['solo', 'date', 'hangout'].includes(value.mode) ? value.mode : 'solo'
  const daypart = ['morning', 'afternoon', 'evening', 'late', 'any'].includes(value.daypart) ? value.daypart : 'any'
  return {
    mode,
    category: String(value.category || '').trim().slice(0, 80) || null,
    payload: {
      daypart,
      mood: String(value.mood || '').trim().slice(0, 80) || null,
      price: String(value.price || '').trim().slice(0, 12) || null,
      source: String(value.source || 'swipe').trim().slice(0, 40)
    }
  }
}

async function ensureLocationExists(supabase, userId, contentId, action) {
  const admin = createAdminClient()
  const existing = await admin.from('locations').select('id').eq('id', contentId).maybeSingle()
  if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
  if (existing.data) return true
  if (action === 'undo') return false

  const profile = await supabase
    .from('profiles')
    .select('latitude,longitude,search_radius_km')
    .eq('id', userId)
    .maybeSingle()
  if (profile.error) throw profile.error
  const latitude = Number(profile.data?.latitude)
  const longitude = Number(profile.data?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false

  const result = await materializeStaticCatalogueLocations({
    admin,
    latitude,
    longitude,
    radiusKm: Math.max(25, Number(profile.data?.search_radius_km || 25), 100),
    locationIds: [contentId]
  })
  return result.materialized.has(contentId)
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Discovery actions are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save discovery choices.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'discovery_action' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many discovery choices were sent. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 8_000))
    const requestedAction = string(body.action, { name: 'action', choices: [...RECOMMENDATION_ACTIONS], max: 20 })
    const action = requestedAction === 'perfect' ? 'saved' : requestedAction
    const contentKind = string(body.contentKind, { name: 'contentKind', choices: KINDS, max: 10 })
    const contentId = uuid(body.contentId, 'contentId')
    const requestId = body.requestId ? uuid(body.requestId, 'requestId') : null

    if (contentKind === 'place') {
      const exists = await ensureLocationExists(supabase, user.id, contentId, action)
      if (!exists && action !== 'undo') {
        return NextResponse.json({ error: 'That catalogue location is no longer available.' }, { status: 404 })
      }
    }

    let result = null
    if (DISCOVERY_ACTIONS.has(action)) {
      const discovery = await supabase.rpc('record_discovery_action_v1', { target_kind: contentKind, target_id: contentId, action_name: action, request_key: requestId })
      if (discovery.error) return NextResponse.json({ error: 'That choice could not be saved.' }, { status: 400 })
      result = discovery.data
    }

    await supabase.rpc('record_recommendation_outcome_v1', {
      request_key: requestId,
      target_kind: contentKind,
      target_id: contentId,
      outcome_name: action,
      outcome_metadata: { surface: 'discover', perfect_pick: requestedAction === 'perfect' }
    })

    const eventName = contextEvent(requestedAction, action)
    if (contentKind === 'place' && eventName) {
      const context = safeContext(body.context)
      await supabase.rpc('record_recommendation_context_v1', {
        target_location: contentId,
        event_name: eventName,
        context_mode: context.mode,
        context_category: context.category,
        context_payload: context.payload,
        context_deck: null
      })
    }

    return NextResponse.json({ ok: true, result, perfectPick: requestedAction === 'perfect' })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That discovery action is not valid.') }, { status: error?.status || 400 })
  }
}
