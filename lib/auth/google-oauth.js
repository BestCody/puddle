import { siteUrl } from './origin'
import { safeNextPath } from './redirect'

export function googleCallbackUrl(headersLike, next = '/discover', legalConsent = false) {
  const callback = siteUrl(headersLike, '/auth/callback')
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
