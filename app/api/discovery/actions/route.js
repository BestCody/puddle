import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { materializeStaticCatalogueReferences, verifiedStaticReference } from '@/lib/app/static-catalogue-materialization'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'

const ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo', 'opened', 'perfect'])
const MATERIALIZING_ACTIONS = new Set(['saved', 'interested', 'visited', 'opened', 'perfect'])
const MAX_ACTIONS = 20

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

function parseAction(raw, index) {
  const value = object(raw)
  const requestedAction = string(value.action, { name: `actions[${index}].action`, choices: [...ACTIONS], max: 20 })
  const contentKind = string(value.contentKind || 'place', { name: `actions[${index}].contentKind`, choices: ['place'], max: 10 })
  const contentId = uuid(value.contentId, `actions[${index}].contentId`)
  const requestId = value.requestId ? uuid(value.requestId, `actions[${index}].requestId`) : null
  const eventId = value.eventId ? uuid(value.eventId, `actions[${index}].eventId`) : crypto.randomUUID()
  const sequence = Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(value.sequence) || index)))
  const staticEphemeral = value.staticCatalogueEphemeral === true
  const staticRef = staticEphemeral ? string(value.staticRef, { name: `actions[${index}].staticRef`, max: 4_096 }) : null
  const reference = staticEphemeral ? verifiedStaticReference(staticRef, contentId) : null
  return {
    requestedAction,
    action: requestedAction === 'perfect' ? 'saved' : requestedAction,
    contentKind,
    contentId,
    requestId,
    eventId,
    sequence,
    staticEphemeral,
    staticRef,
    reference,
    context: safeContext(value.context)
  }
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Discovery actions are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save discovery choices.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'discovery_action_batch' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many discovery choices were sent. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 96_000))
    const rawActions = Array.isArray(body.actions) ? body.actions : []
    if (rawActions.length < 1 || rawActions.length > MAX_ACTIONS) {
      return NextResponse.json({ error: `Send between 1 and ${MAX_ACTIONS} actions.` }, { status: 400 })
    }
    const actions = rawActions.map(parseAction).sort((a, b) => a.sequence - b.sequence)
    const admin = createAdminClient()
    const positive = actions.filter((item) => item.staticEphemeral && MATERIALIZING_ACTIONS.has(item.requestedAction))
    const materialization = positive.length
      ? await materializeStaticCatalogueReferences({
          admin,
          locationIds: positive.map((item) => item.contentId),
          references: positive.map((item) => ({ id: item.contentId, token: item.staticRef }))
        })
      : { materialized: new Map(), missing: [] }

    if (materialization.missing.length) {
      return NextResponse.json({ error: 'One or more catalogue locations are no longer available.' }, { status: 409 })
    }

    const rpcActions = actions.map((item) => ({
      eventId: item.eventId,
      sequence: item.sequence,
      contentKind: item.contentKind,
      contentId: materialization.materialized.get(item.contentId)?.id || item.contentId,
      action: item.action,
      requestedAction: item.requestedAction,
      requestId: item.requestId,
      context: item.context,
      staticEphemeral: item.staticEphemeral,
      staticSource: item.reference?.source || null,
      staticSourcePlaceId: item.reference?.sourcePlaceId || null
    }))
    const recorded = await supabase.rpc('record_discovery_actions_v4', { actions: rpcActions })
    if (recorded.error) {
      console.warn('Discovery action batch RPC failed.', {
        code: recorded.error.code || null,
        message: String(recorded.error.message || '').slice(0, 240),
        count: rpcActions.length
      })
      return NextResponse.json({ error: 'Those choices could not be saved.' }, { status: 400 })
    }
    after(async () => {
      const processed = await admin.rpc('process_discovery_context_outbox_v1', { batch_limit: 100 })
      if (processed.error) console.warn('Discovery context outbox processing failed.', { code: processed.error.code || null, message: String(processed.error.message || '').slice(0, 240) })
    })
    return NextResponse.json({ ok: true, results: recorded.data || [], count: rpcActions.length })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That discovery action batch is not valid.') }, { status: error?.status || 400 })
  }
}
