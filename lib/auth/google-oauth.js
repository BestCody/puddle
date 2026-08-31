import { normalizeOrigin, requestOrigin } from './origin'
import { safeNextPath } from './redirect'

function siteOrigin(headersLike) {
  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://puddle.you'
  return requestOrigin(headersLike, 'http://localhost:3000')
}

export function googleCallbackUrl(headersLike, next = '/discover', legalConsent = false) {
  const callback = new URL('/auth/callback', siteOrigin(headersLike))
  callback.searchParams.set('next', safeNextPath(next, '/discover'))
  if (legalConsent) callback.searchParams.set('legal_consent', '1')
  return callback.toString()
}

export async function startGoogleOAuth(supabase, headersLike, next = '/discover', legalConsent = false) {
  await supabase.auth.signOut({ scope: 'local' })
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: googleCallbackUrl(headersLike, next, legalConsent) }
  })
}
