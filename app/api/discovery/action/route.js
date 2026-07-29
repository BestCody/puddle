import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

const ACTIONS = new Set(['saved', 'interested', 'dismissed', 'visited', 'undo'])
const KINDS = new Set(['event', 'place'])

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Discovery actions are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save discovery choices.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || '')
  const contentKind = String(body.contentKind || '')
  const contentId = String(body.contentId || '')
  if (!ACTIONS.has(action) || !KINDS.has(contentKind) || !/^[0-9a-f-]{36}$/i.test(contentId)) {
    return NextResponse.json({ error: 'That discovery action is not valid.' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('record_discovery_action_v1', {
    target_kind: contentKind,
    target_id: contentId,
    action_name: action,
    request_key: String(body.requestId || '').slice(0, 80) || null
  })
  if (error) return NextResponse.json({ error: 'That choice could not be saved.' }, { status: 400 })
  return NextResponse.json({ ok: true, result: data })
}
