import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { allowedCorsOrigins, applySecurityHeaders, applicationOrigin, nonceValue } from '@/lib/security/headers'
import { isUnsafeMethod } from '@/lib/security/request'
import { canonicalPuddleAuthUrl } from '@/lib/auth/origin'
import { SERVER_LATENCY_BUDGET_MS, appendServerTiming, elapsedMs, latencyStart, recordServerLatency } from '@/lib/performance/server-latency'

const protectedPrefixes = ['/dashboard','/discover','/matches','/global-matches','/membership','/map','/plans','/create','/studio','/report','/profile','/onboarding','/account','/change-email','/settings','/appeals','/admin']
const productRoutePrefixes = ['/discover','/map','/plans','/matches','/membership','/profile','/global-matches','/create']
const authOnlyPaths = ['/signin','/signup','/forgot-password']
const staticLandingPaths = new Set(['/','/landing.html','/index.html','/responsive-landing'])
const cacheablePublicPaths = new Set([...staticLandingPaths, '/privacy', '/terms'])
const authCanonicalPaths = new Set(['/signin','/signup','/forgot-password','/verify-email','/update-password','/change-email','/auth/callback','/auth/confirm','/auth/error'])
const publicNoSessionPaths = new Set([...cacheablePublicPaths, '/verify-email', '/auth/callback', '/auth/confirm', '/auth/error'])
const verifiedProductUserHeader = 'x-puddle-verified-user-id'
const moderationExemptApiPrefixes = [
  '/api/appeals',
  '/api/auth',
  '/api/security',
  '/api/health',
  '/api/system',
  '/api/location-photos',
  '/api/billing/webhook'
]
// These exact read routes perform their own claims and account-state checks so
// the proxy does not serialize a second claims/profile round trip ahead of them.
const moderationExemptApiPaths = new Set(['/api/discovery', '/api/map/viewport'])

function carriesCookies(source, target) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie.name, cookie.value, cookie)
  return target
}
function secured(response, context) { return applySecurityHeaders(response, context) }
function forbidden(request, nonce, message = 'Cross-site request blocked.') { return secured(NextResponse.json({ error: message }, { status: 403 }), { request, nonce }) }
function hasSupabaseAuthCookie(request) { return request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/i.test(name)) }
function matchesPrefix(pathname, prefixes) { return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) }
function requiresModerationGate(pathname) {
  return pathname.startsWith('/api/') && !moderationExemptApiPaths.has(pathname) && !moderationExemptApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
function cachePolicy(response, pathname, privateResponse = false) {
  if (privateResponse) { response.headers.set('Cache-Control', 'private, no-store'); return response }
  if (staticLandingPaths.has(pathname)) {
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
  } else if (cacheablePublicPaths.has(pathname)) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  } else response.headers.set('Cache-Control', 'no-store')
  return response
}
function timed(response, startedAt, timings = []) {
  const totalMs = elapsedMs(startedAt)
  recordServerLatency('proxy_session', totalMs, SERVER_LATENCY_BUDGET_MS.proxySession)
  return appendServerTiming(response, [...timings, { name: 'proxy', durationMs: totalMs }])
}

export async function proxy(request) {
  const proxyStartedAt = latencyStart()
  const nonce = nonceValue()
  const pathname = request.nextUrl.pathname
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') || request.headers.get('cf-ray') || crypto.randomUUID())
  requestHeaders.delete('x-puddle-product-route')
  requestHeaders.delete(verifiedProductUserHeader)
  if (matchesPrefix(pathname, productRoutePrefixes)) requestHeaders.set('x-puddle-product-route', '1')

  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin')
    if (!origin || !allowedCorsOrigins(request).has(origin)) return forbidden(request, nonce, 'Origin is not allowed.')
    const response = new NextResponse(null, { status: 204 })
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'content-type,x-puddle-device,x-puddle-csrf,x-puddle-action')
    response.headers.set('Access-Control-Max-Age', '600')
    response.headers.set('Vary', 'Origin')
    return secured(response, { request, nonce })
  }

  if (isUnsafeMethod(request.method)) {
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return forbidden(request, nonce)
    const origin = request.headers.get('origin')
    if (origin && origin !== applicationOrigin(request)) return forbidden(request, nonce, 'Origin is not allowed.')
  }

  const maxBytes = pathname === '/api/media/upload' ? 20_000_000 : pathname.startsWith('/api/') ? 256_000 : 2_000_000
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBytes) return secured(NextResponse.json({ error: 'Request payload is too large.' }, { status: 413 }), { request, nonce })

  const canonicalTarget = (request.method === 'GET' || request.method === 'HEAD')
    ? canonicalPuddleAuthUrl(request.url, process.env.NEXT_PUBLIC_SITE_URL, authCanonicalPaths)
    : null
  if (canonicalTarget) return secured(NextResponse.redirect(canonicalTarget, 307), { request, nonce })

  if (publicNoSessionPaths.has(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname), { request, nonce, staticScripts: staticLandingPaths.has(pathname) })
  }

  const isLandingDemo = pathname === '/landing-demo' || pathname.startsWith('/landing-demo/')
  if (isLandingDemo) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname), { request, nonce })
  }

  const isProtected = matchesPrefix(pathname, protectedPrefixes)
  const isAuthOnly = authOnlyPaths.includes(pathname)
  const hasAuthFailure = request.nextUrl.searchParams.has('error') || request.nextUrl.searchParams.has('auth_error')
  const moderationGate = requiresModerationGate(pathname)
  const hasAuthCookie = hasSupabaseAuthCookie(request)
  const needsSession = isProtected || (hasAuthCookie && (!pathname.startsWith('/api/') || moderationGate))

  if (!needsSession) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname, isAuthOnly), { request, nonce })
  }

  const session = await updateSession(request, requestHeaders, { loadProfileState: moderationGate })
  const { user, profileState, profileError, configured, timings } = session
  let { response } = session
  if (user && matchesPrefix(pathname, productRoutePrefixes)) {
    // The proxy has already verified this ID with getClaims(). Strip any inbound
    // value above, then forward only the verified ID to Server Components so they
    // do not repeat the same auth verification. Request override headers are not
    // exposed to the browser.
    requestHeaders.set(verifiedProductUserHeader, user.id)
    response = carriesCookies(response, NextResponse.next({ request: { headers: requestHeaders } }))
  }
  if (moderationGate && user && profileError) {
    return timed(secured(cachePolicy(NextResponse.json({ error: 'Account status could not be verified.' }, { status: 503 }), pathname, true), { request, nonce }), proxyStartedAt, timings)
  }
  if (moderationGate && user && (profileState?.suspended_at || profileState?.banned_at)) {
    return timed(secured(cachePolicy(NextResponse.json({ error: profileState?.banned_at ? 'This account is banned.' : 'This account is suspended.' }, { status: 403 }), pathname, true), { request, nonce }), proxyStartedAt, timings)
  }
  if (isProtected && !configured) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('error', 'Accounts are temporarily unavailable. Please try again later.')
    return timed(secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce }), proxyStartedAt, timings)
  }
  if (isProtected && !user) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return timed(secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce }), proxyStartedAt, timings)
  }
  if (isAuthOnly && user && !hasAuthFailure) {
    return timed(secured(cachePolicy(carriesCookies(response, NextResponse.redirect(new URL('/discover', request.url))), pathname, true), { request, nonce }), proxyStartedAt, timings)
  }
  return timed(secured(cachePolicy(response, pathname, Boolean(user) || isProtected || isAuthOnly), { request, nonce }), proxyStartedAt, timings)
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'] }
