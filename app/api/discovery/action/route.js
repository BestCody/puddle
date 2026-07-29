import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

const DISCOVERY_ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo'])
const RECOMMENDATION_ACTIONS = new Set([...DISCOVERY_ACTIONS, 'opened'])
const KINDS = new Set(['event', 'place'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Discovery actions are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save discovery choices.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || '')
  const contentKind = String(body.contentKind || '')
  const contentId = String(body.contentId || '')
  const requestId = UUID.test(String(body.requestId || '')) ? String(body.requestId) : null
  if (!RECOMMENDATION_ACTIONS.has(action) || !KINDS.has(contentKind) || !UUID.test(contentId)) return NextResponse.json({ error: 'That discovery action is not valid.' }, { status: 400 })

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
}
