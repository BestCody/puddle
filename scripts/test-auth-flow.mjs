import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authCallbackUrl, canonicalPuddleAuthUrl, normalizeOrigin, requestOrigin } from '../lib/auth/origin.js'

const root = fileURLToPath(new URL('..', import.meta.url))

assert.equal(normalizeOrigin('https://www.puddle.you/path'), 'https://www.puddle.you')
assert.equal(normalizeOrigin('javascript:alert(1)'), null)

const wwwHeaders = new Headers({
  origin: 'https://www.puddle.you',
  host: 'www.puddle.you',
  'x-forwarded-host': 'www.puddle.you',
  'x-forwarded-proto': 'https'
})
assert.equal(requestOrigin(wwwHeaders, 'https://puddle.you'), 'https://www.puddle.you')
assert.equal(authCallbackUrl(wwwHeaders, '/auth/callback?next=/onboarding', 'https://puddle.you'), 'https://www.puddle.you/auth/callback?next=/onboarding')

const apexHeaders = new Headers({
  origin: 'https://puddle.you',
  host: 'puddle.you',
  'x-forwarded-host': 'puddle.you',
  'x-forwarded-proto': 'https'
})
assert.equal(requestOrigin(apexHeaders, 'https://www.puddle.you'), 'https://puddle.you')

const spoofedOriginHeaders = new Headers({
  origin: 'https://attacker.example',
  host: 'puddle.you',
  'x-forwarded-host': 'puddle.you',
  'x-forwarded-proto': 'https'
})
assert.equal(requestOrigin(spoofedOriginHeaders, 'https://puddle.you'), 'https://puddle.you')

const localHeaders = new Headers({ host: 'localhost:3000' })
assert.equal(requestOrigin(localHeaders, 'https://puddle.you'), 'http://localhost:3000')

const authPaths = new Set(['/signin', '/signup', '/auth/callback', '/auth/confirm'])
assert.equal(
  canonicalPuddleAuthUrl('https://www.puddle.you/signup?email=ava%40example.com', 'https://puddle.you', authPaths)?.toString(),
  'https://puddle.you/signup?email=ava%40example.com'
)
assert.equal(
  canonicalPuddleAuthUrl('https://www.puddle.you/auth/callback?code=abc&next=/onboarding', 'https://puddle.you', authPaths)?.toString(),
  'https://puddle.you/auth/callback?code=abc&next=/onboarding'
)
assert.equal(canonicalPuddleAuthUrl('https://puddle.you/signin', 'https://puddle.you', authPaths), null)
assert.equal(canonicalPuddleAuthUrl('https://preview.vercel.app/signin', 'https://puddle.you', authPaths), null)
assert.equal(canonicalPuddleAuthUrl('https://www.puddle.you/privacy', 'https://puddle.you', authPaths), null)

const proxy = await readFile(join(root, 'proxy.js'), 'utf8')
const canonicalCheck = proxy.indexOf('const canonicalTarget = (request.method')
const publicBypass = proxy.indexOf('if (publicNoSessionPaths.has(pathname))')
const sessionLookup = proxy.indexOf('await updateSession(request, requestHeaders)')
assert(canonicalCheck >= 0, 'Proxy must canonicalize auth routes')
assert(proxy.includes('canonicalPuddleAuthUrl(request.url'), 'Proxy must use the tested canonical URL helper')
assert(publicBypass > canonicalCheck, 'Canonical redirect must run before the public callback bypass')
assert(sessionLookup > publicBypass, 'Auth callbacks must bypass session lookup before code exchange')
for (const path of ['/auth/callback', '/auth/confirm']) {
  assert(proxy.includes(`'${path}'`), `Proxy must treat ${path} as a no-session callback route`)
}

const callback = await readFile(join(root, 'app/auth/callback/route.js'), 'utf8')
assert(callback.includes("url.searchParams.get('error')"), 'OAuth provider errors must be handled')
assert(callback.includes('exchangeCodeForSession(code)'), 'OAuth code exchange is missing')
assert(callback.includes("target.searchParams.set('auth_error', safeCode)"), 'OAuth callback needs a sanitized diagnostic code')
assert(callback.includes('safeAuthErrorCode'), 'OAuth callback must sanitize provider and exchange errors')
assert(callback.includes('ensureProfile(supabase, user)'), 'OAuth callback must recover a missing profile')
assert(callback.includes('authenticatedDestination(profile, next)'), 'OAuth callback must route incomplete accounts to onboarding')
assert(!callback.includes("new URL('/auth/error'"), 'OAuth callback should not dump users onto the generic error page')

const confirm = await readFile(join(root, 'app/auth/confirm/route.js'), 'utf8')
assert(confirm.includes('verifyOtp({ token_hash: tokenHash, type })'), 'Email link exchange is missing')
assert(confirm.includes("target.searchParams.set('auth_error', safeCode)"), 'Email links need a sanitized diagnostic code')
assert(confirm.includes('authLinkErrorMessage'), 'Email links must map expired and reused links to useful messages')
assert(confirm.includes('ensureProfile(supabase, user)'), 'Email links must recover a missing profile')
assert(confirm.includes('authenticatedDestination(profile, next)'), 'Email links must route accounts correctly')
assert(!confirm.includes("new URL('/auth/error'"), 'Email links should not dump users onto the generic error page')

const actions = await readFile(join(root, 'app/auth/actions.js'), 'utf8')
for (const marker of ['signInWithPassword', 'signUp({', "provider !== 'google'", 'exchangeCodeForSession']) {
  const source = marker === 'exchangeCodeForSession' ? callback : actions
  assert(source.includes(marker), `Authentication source is missing ${marker}`)
}
for (const marker of ['saveOnboardingDraft', 'profileWriteErrorMessage', 'ensureProfile', 'resetPasswordForEmail', "signOut({ scope: 'local' })"]) {
  assert(actions.includes(marker), `Authentication lifecycle is missing ${marker}`)
}
assert(actions.includes('updateUserById(user.id, { email_confirm: true })'), 'Hosted signup must auto-confirm new users when Supabase still requires confirmation')
assert(!actions.includes('/verify-email?email='), 'New signups must not be redirected to email verification')

const supabaseConfig = await readFile(join(root, 'supabase/config.toml'), 'utf8')
assert(supabaseConfig.includes('enable_confirmations = false'), 'Local email signup confirmations must be disabled')

console.log('Authentication origin, canonical host, instant signup, sign-in, password reset, email links, sign-out, and onboarding regression checks passed.')