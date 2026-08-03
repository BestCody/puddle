import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueReferences, verifiedStaticReference } from '@/lib/app/static-catalogue-materialization'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'
import { legacySystemsEnabled } from '@/lib/product-vision'

const DISCOVERY_ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo'])
const RECOMMENDATION_ACTIONS = new Set([...DISCOVERY_ACTIONS, 'opened', 'perfect'])
const MATERIALIZING_ACTIONS = new Set(['saved', 'interested', 'visited', 'opened', 'perfect'])
const KINDS = legacySystemsEnabled() ? ['event', 'place'] : ['place']

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

function diagnostic(error) {
  if (process.env.E2E_DIAGNOSTICS !== 'true') return {}
  return {
    diagnosticCode: String(error?.code || '').slice(0, 80) || null,
    diagnosticMessage: String(error?.message || 'unknown failure').slice(0, 500),
    diagnosticDetails: String(error?.details || '').slice(0, 500) || null,
    diagnosticHint: String(error?.hint || '').slice(0, 300) || null
  }
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
    const body = object(await readJsonLimited(request, 12_000))
    const requestedAction = string(body.action, { name: 'action', choices: [...RECOMMENDATION_ACTIONS], max: 20 })
    const action = requestedAction === 'perfect' ? 'saved' : requestedAction
    const contentKind = string(body.contentKind, { name: 'contentKind', choices: KINDS, max: 10 })
    const contentId = uuid(body.contentId, 'contentId')
    const requestId = body.requestId ? uuid(body.requestId, 'requestId') : null
    const staticEphemeral = contentKind === 'place' && body.staticCatalogueEphemeral === true
    const staticRef = staticEphemeral ? string(body.staticRef, { name: 'staticRef', max: 4_096 }) : null
    const reference = staticEphemeral ? verifiedStaticReference(staticRef, contentId) : null

    let targetId = contentId
    if (staticEphemeral && MATERIALIZING_ACTIONS.has(requestedAction)) {
      const result = await materializeStaticCatalogueReferences({
        admin: createAdminClient(),
        locationIds: [contentId],
        references: [{ id: contentId, token: staticRef }]
      })
      if (!result.materialized.has(contentId)) {
        return NextResponse.json({ error: 'That catalogue location is no longer available.' }, { status: 404 })
      }
      targetId = result.materialized.get(contentId)?.id || contentId
    }

    const context = safeContext(body.context)
    const recorded = await supabase.rpc('record_discovery_action_v2', {
      target_kind: contentKind,
      target_id: targetId,
      action_name: action,
      requested_action: requestedAction,
      request_key: requestId,
      context_mode: context.mode,
      context_category: context.category,
      context_payload: context.payload,
      is_static_ephemeral: staticEphemeral,
      static_source: reference?.source || null,
      static_source_place_id: reference?.sourcePlaceId || null
    })
    if (recorded.error) {
      console.warn('Discovery action RPC failed.', {
        code: recorded.error.code || null,
        message: String(recorded.error.message || '').slice(0, 240),
        staticEphemeral,
        action
      })
      return NextResponse.json({ error: 'That choice could not be saved.', ...diagnostic(recorded.error) }, { status: 400 })
    }

    return NextResponse.json({ ok: true, result: recorded.data, perfectPick: requestedAction === 'perfect' })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That discovery action is not valid.'), ...diagnostic(error) }, { status: error?.status || 400 })
  }
}
