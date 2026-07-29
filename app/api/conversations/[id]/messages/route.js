import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

const ACTIONS = new Set(['send','edit','delete','react','read','mute'])
function clean(value, max = 5000) { return String(value || '').trim().slice(0, max) }
function safeMessage(error, fallback) {
  const value = clean(error?.message, 240)
  return value && !/policy|permission|schema|relation|supabase|function/i.test(value) ? value : fallback
}

export async function POST(request, context) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Messages are temporarily unavailable.' }, { status: 503 })
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use messages.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const action = clean(body.action, 20) || 'send'
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown message action.' }, { status: 400 })

  let name
  let args
  if (action === 'send') {
    name = 'send_message_v1'
    args = { target: id, message_body: clean(body.body), reply_target: Number(body.replyTo) || null, message_kind: body.attachment ? 'attachment' : clean(body.messageType, 20) || 'text', message_metadata: body.attachment || {} }
  } else if (action === 'edit') {
    name = 'edit_message_v1'; args = { target: Number(body.messageId), new_body: clean(body.body) }
  } else if (action === 'delete') {
    name = 'delete_message_v1'; args = { target: Number(body.messageId) }
  } else if (action === 'react') {
    name = 'react_message_v1'; args = { target: Number(body.messageId), reaction: clean(body.emoji, 16) }
  } else if (action === 'read') {
    name = 'mark_conversation_read_v1'; args = { target: id, last_message: Number(body.messageId) || null }
  } else {
    name = 'mute_conversation_v1'; args = { target: id, until_time: body.until || null }
  }
  const { data, error } = await supabase.rpc(name, args)
  if (error) return NextResponse.json({ error: safeMessage(error, 'That message action could not be completed.') }, { status: 400 })
  return NextResponse.json({ ok: true, result: data })
}
