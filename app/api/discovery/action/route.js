import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'

const DISCOVERY_ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo'])
const RECOMMENDATION_ACTIONS = new Set([...DISCOVERY_ACTIONS, 'opened'])
const KINDS = ['event', 'place']

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
    const action = string(body.action, { name: 'action', choices: [...RECOMMENDATION_ACTIONS], max: 20 })
    const contentKind = string(body.contentKind, { name: 'contentKind', choices: KINDS, max: 10 })
    const contentId = uuid(body.contentId, 'contentId')
    const requestId = body.requestId ? uuid(body.requestId, 'requestId') : null

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
      outcome_metadata: { surface: 'discover' }
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That discovery action is not valid.') }, { status: error?.status || 400 })
  }
}
