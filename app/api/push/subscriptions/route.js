import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { object, string } from '@/lib/security/schema'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

function safeEndpoint(value) {
  const endpoint = string(value, { name: 'endpoint', min: 20, max: 2000 })
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw Object.assign(new Error('Push endpoint must use HTTPS.'), { status: 400 })
  return url.toString()
}

async function authenticated() {
  if (!isSupabaseConfigured()) return { response: NextResponse.json({ error: 'Push notifications are unavailable.' }, { status: 503 }) }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Sign in to manage push notifications.' }, { status: 401 }) }
  return { supabase, user }
}

export async function GET() {
  const auth = await authenticated()
  if (auth.response) return auth.response
  const { count, error } = await auth.supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('profile_id', auth.user.id)
  if (error) return NextResponse.json({ error: 'Push status could not be loaded.' }, { status: 400 })
  return NextResponse.json({ enabled: Number(count || 0) > 0, subscriptionCount: Number(count || 0), publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null }, { headers: { 'cache-control': 'private, no-store' } })
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  const auth = await authenticated()
  if (auth.response) return auth.response
  const limited = await enforceRateLimit({ headers: request.headers, userId: auth.user.id, action: 'push_subscription' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many push changes were sent.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })
  try {
    const body = object(await readJsonLimited(request, 12_000))
    const endpoint = safeEndpoint(body.endpoint)
    const keys = object(body.keys)
    const p256dh = string(keys.p256dh, { name: 'p256dh', min: 20, max: 500 })
    const authKey = string(keys.auth, { name: 'auth', min: 8, max: 500 })
    const { error } = await auth.supabase.from('push_subscriptions').upsert({
      profile_id: auth.user.id,
      endpoint,
      p256dh,
      auth: authKey,
      user_agent: String(request.headers.get('user-agent') || '').slice(0, 500) || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' })
    if (error) return NextResponse.json({ error: 'This device could not be registered for push notifications.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That push subscription is invalid.') }, { status: error?.status || 400 })
  }
}

export async function DELETE(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  const auth = await authenticated()
  if (auth.response) return auth.response
  try {
    const body = object(await readJsonLimited(request, 8_000))
    let query = auth.supabase.from('push_subscriptions').delete().eq('profile_id', auth.user.id)
    if (body.endpoint) query = query.eq('endpoint', safeEndpoint(body.endpoint))
    const { error } = await query
    if (error) return NextResponse.json({ error: 'Push notifications could not be disabled.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That push subscription is invalid.') }, { status: error?.status || 400 })
  }
}
