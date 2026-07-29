import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DECISIONS = new Set(['accept','reject','rollback'])

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Creation assistance is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to review suggestions.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const runId = String(body.runId || '')
  const decision = String(body.decision || '')
  if (!UUID.test(runId) || !DECISIONS.has(decision)) return NextResponse.json({ error: 'That review decision is invalid.' }, { status: 400 })
  const edited = decision === 'accept' && body.editedOutput && typeof body.editedOutput === 'object' ? body.editedOutput : null
  const contentId = UUID.test(String(body.contentId || '')) ? String(body.contentId) : null
  const { data, error } = await supabase.rpc('decide_ai_assistance_v1', { target_run: runId, decision, edited_output: edited, attach_content_id: contentId })
  if (error) return NextResponse.json({ error: 'That suggestion could not be updated.' }, { status: 400 })
  return NextResponse.json({ ok: true, result: data })
}
