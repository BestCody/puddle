import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authCallbackUrl, normalizeOrigin, requestOrigin } from '../lib/auth/origin.js'

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

const proxy = await readFile(join(root, 'proxy.js'), 'utf8')
const canonicalCheck = proxy.indexOf('const canonicalTarget = canonicalAuthTarget(request, pathname)')
const publicBypass = proxy.indexOf('if (publicNoSessionPaths.has(pathname))')
const sessionLookup = proxy.indexOf('await updateSession(request, requestHeaders)')
assert(canonicalCheck >= 0, 'Proxy must canonicalize auth routes')
assert(publicBypass > canonicalCheck, 'Canonical redirect must run before the public callback bypass')
assert(sessionLookup > publicBypass, 'Auth callbacks must bypass session lookup before code exchange')
for (const path of ['/auth/callback', '/auth/confirm']) {
  assert(proxy.includes(`'${path}'`), `Proxy must treat ${path} as a no-session callback route`)
}
assert(proxy.includes("hostname === 'puddle.you' || hostname === 'www.puddle.you'"), 'Canonical host guard is missing')

const callback = await readFile(join(root, 'app/auth/callback/route.js'), 'utf8')
assert(callback.includes("url.searchParams.get('error')"), 'OAuth provider errors must be handled')
assert(callback.includes('exchangeCodeForSession(code)'), 'OAuth code exchange is missing')
assert(callback.includes("target.searchParams.set('auth_error', code)"), 'OAuth callback needs a safe diagnostic code')
assert(!callback.includes("new URL('/auth/error'"), 'OAuth callback should not dump users onto the generic error page')

const confirm = await readFile(join(root, 'app/auth/confirm/route.js'), 'utf8')
assert(confirm.includes('verifyOtp({ token_hash: tokenHash, type })'), 'Email confirmation exchange is missing')
assert(confirm.includes("target.searchParams.set('auth_error', code)"), 'Email confirmation needs a safe diagnostic code')
assert(!confirm.includes("new URL('/auth/error'"), 'Email confirmation should not dump users onto the generic error page')

const actions = await readFile(join(root, 'app/auth/actions.js'), 'utf8')
for (const marker of ['signInWithPassword', 'signUp({', "provider !== 'google'", 'exchangeCodeForSession']) {
  const source = marker === 'exchangeCodeForSession' ? callback : actions
  assert(source.includes(marker), `Authentication source is missing ${marker}`)
}

console.log('Authentication origin, callback, email confirmation, sign-in, and sign-up regression checks passed.')
