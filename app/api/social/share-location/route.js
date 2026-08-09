import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Sharing is temporarily unavailable.' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to share places.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'social_share_location' })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many shares. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  try {
    const body = object(await readJsonLimited(request, 16_000))
    const friendId = uuid(body.friendId, 'friendId')
    const locationId = uuid(body.locationId, 'locationId')
    const note = body.note ? string(body.note, { name: 'note', max: 1000 }) : null
    const shared = await supabase.rpc('send_location_to_friend_v1', {
      target_friend: friendId,
      target_location: locationId,
      share_note: note
    })
    if (shared.error) return NextResponse.json({ error: 'That place could not be sent to this friend.' }, { status: 400 })
    return NextResponse.json({ ok: true, ...shared.data })
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'That share request is not valid.') }, { status: error?.status || 400 })
  }
}
