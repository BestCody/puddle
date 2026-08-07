import { NextResponse } from 'next/server'
import { getB2DownloadAuthorization, managedB2ObjectKey } from '@/lib/app/b2-private-download'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Private asset access is unavailable.' }, {
      status: 503,
      headers: { 'cache-control': 'private, no-store' }
    })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to load private catalogue assets.' }, {
      status: 401,
      headers: { 'cache-control': 'private, no-store' }
    })
  }

  const key = managedB2ObjectKey(request.nextUrl.searchParams.get('key'))
  if (!key) {
    return NextResponse.json({ error: 'Unknown private asset object.' }, {
      status: 400,
      headers: { 'cache-control': 'private, no-store' }
    })
  }

  try {
    const authorization = await getB2DownloadAuthorization(key)
    return NextResponse.json({
      baseUrl: authorization.baseUrl,
      key: authorization.key,
      authorizationToken: authorization.authorizationToken,
      expiresAt: new Date(authorization.expiresAt).toISOString()
    }, {
      headers: {
        'cache-control': 'private, no-store',
        pragma: 'no-cache',
        vary: 'Cookie'
      }
    })
  } catch (error) {
    console.warn('Private B2 access issuance failed.', {
      code: String(error?.code || '').slice(0, 80) || null,
      status: Number(error?.status || 0) || null,
      message: String(error?.message || 'unknown failure').slice(0, 200)
    })
    return NextResponse.json({ error: 'Private asset access is temporarily unavailable.' }, {
      status: 503,
      headers: { 'cache-control': 'private, no-store' }
    })
  }
}
