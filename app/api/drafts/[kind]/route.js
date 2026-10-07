import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { LocationDraftError, saveLocationSubmission } from '@/lib/app/location-draft-write'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { readJsonLimited, safeSecurityError } from '@/lib/security/request'

export const dynamic = 'force-dynamic'

export async function POST(request, context) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
  const { kind } = await context.params
  if (kind !== 'place') return NextResponse.json({ error: 'Unknown draft type.' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to save drafts.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'draft_autosave' })
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Drafts are being saved too quickly. Pause briefly and try again.' }, {
      status: 429,
      headers: { 'retry-after': String(limited.retryAfter || 60) }
    })
  }

  let input
  try {
    input = await readJsonLimited(request, 64_000)
  } catch (error) {
    return NextResponse.json({ error: safeSecurityError(error, 'The draft could not be read.') }, { status: error?.status || 400 })
  }

  try {
    const draft = await saveLocationSubmission(supabase, user.id, input)
    return NextResponse.json({ saved: true, draft })
  } catch (error) {
    if (!(error instanceof LocationDraftError)) {
      return NextResponse.json({ error: 'Draft saving is temporarily unavailable.' }, { status: 503 })
    }
    const status = error.code === 'validation' ? 422
      : error.code === 'not_found' ? 404
        : error.code === 'pass_required' ? 403 : 503
    return NextResponse.json({ saved: false, waiting: error.code === 'validation', error: error.message }, { status })
  }
}
