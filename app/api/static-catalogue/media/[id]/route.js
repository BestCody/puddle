import { NextResponse } from 'next/server'
import { resolveStaticCatalogueMedia } from '@/lib/app/static-media-resolver'
import { staticMediaRuntimeConfiguration } from '@/lib/app/static-media-runtime-config'
import { markCurrentNoMatch, reopenLegacyNoMatch } from '@/lib/app/static-media-resolution-policy'
import { verifyStaticCatalogueReference } from '@/lib/app/static-catalogue-ref'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'
import { object, string, uuid } from '@/lib/security/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request, { params }) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Media resolution is unavailable.' }, { status: 503 })
  const config = staticMediaRuntimeConfiguration()
  if (!config.enabled) return NextResponse.json({ state: 'disabled' }, { status: 503 })

  try {
    const { id: rawId } = await params
    const id = uuid(rawId, 'location id')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to resolve location media.' }, { status: 401 })

    const body = object(await readJsonLimited(request, 8_192))
    const referenceToken = string(body.ref, { name: 'static catalogue reference', max: 4_096 })
    const mode = body.mode === undefined ? 'full' : string(body.mode, { name: 'media resolution mode', max: 20 })
    if (!['full', 'open_only'].includes(mode)) throw Object.assign(new Error('Unsupported media resolution mode.'), { status: 400 })

    const limited = await enforceRateLimit({
      headers: request.headers,
      userId: user.id,
      action: 'static_media_resolve',
      weight: mode === 'open_only' ? 2 : 5
    })
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many media lookups were requested. Try again shortly.' },
        { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } }
      )
    }

    const reference = verifyStaticCatalogueReference(referenceToken, { expectedId: id })
    const admin = createAdminClient()
    await reopenLegacyNoMatch(admin, reference)
    const result = await resolveStaticCatalogueMedia(reference, { mode, config, admin })
    if (mode === 'full' && result.payload?.state === 'no_match') {
      await markCurrentNoMatch(admin, reference)
    }
    return NextResponse.json(result.payload, {
      status: result.status,
      headers: { 'Cache-Control': 'private, no-store' }
    })
  } catch (error) {
    return NextResponse.json(
      { error: safeSecurityError(error, 'That catalogue media request is invalid.') },
      { status: error?.status || 400 }
    )
  }
}
