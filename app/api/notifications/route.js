import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { object, string, uuid } from '@/lib/security/schema'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Notifications are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view notifications.' }, { status: 401 })
  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1'
  const after = request.nextUrl.searchParams.get('after')
  let query = supabase.from('app_notifications').select('id,kind,title,body,href,metadata,read_at,created_at').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(50)
  if (unreadOnly) query = query.is('read_at', null)
  if (after && !Number.isNaN(new Date(after).getTime())) query = query.gt('created_at', new Date(after).toISOString())
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Notifications could not be loaded.' }, { status: 400 })
  const items = data || []
  return NextResponse.json({ items, unreadCount: items.filter((item) => !item.read_at).length }, { headers: { 'cache-control': 'private, no-store' } })
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Notifications are unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to update notifications.' }, { status: 401 })
  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'notification_update' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many notification updates were sent.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })
  try {
    const body = object(await readJsonLimited(request, 8_000))
    const action = string(body.action, { name: 'action', choices: ['read', 'read_all'], max: 20 })
    let query = supabase.from('app_notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', user.id).is('read_at', null)
    if (action === 'read') query = query.eq('id', uuid(body.id, 'id'))
    const { error } = await query
    if (error) return NextResponse.json({ error: 'That notification could not be updated.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That notification update is invalid.') }, { status: error?.status || 400 })
  }
}
