import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { allowedCorsOrigins, applySecurityHeaders, applicationOrigin, nonceValue } from '@/lib/security/headers'
import { isUnsafeMethod } from '@/lib/security/request'
import { canonicalPuddleAuthUrl } from '@/lib/auth/origin'
import { isLegacyApiPath, legacyRedirectForPath, legacySystemsEnabled } from '@/lib/product-vision'

const protectedPrefixes = ['/dashboard','/discover','/date-match','/explore','/plans','/create','/studio','/report','/friends','/inbox','/notifications','/profile','/onboarding','/account','/change-email','/wallet','/orders','/settings','/appeals','/admin']
const authOnlyPaths = ['/signin','/signup','/forgot-password']
const csrfExempt = new Set(['/api/stripe/webhook'])
const staticLandingPaths = new Set(['/','/landing.html','/index.html','/responsive-landing'])
const cacheablePublicPaths = new Set([...staticLandingPaths, '/privacy', '/terms'])
const authCanonicalPaths = new Set(['/signin','/signup','/forgot-password','/verify-email','/update-password','/change-email','/auth/callback','/auth/confirm','/auth/error'])
const publicNoSessionPaths = new Set([...cacheablePublicPaths, '/verify-email', '/auth/callback', '/auth/confirm', '/auth/error'])

function carriesCookies(source, target) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie.name, cookie.value, cookie)
  return target
}

function secured(response, context) { return applySecurityHeaders(response, context) }
function forbidden(request, nonce, message = 'Cross-site request blocked.') { return secured(NextResponse.json({ error: message }, { status: 403 }), { request, nonce }) }
function hasSupabaseAuthCookie(request) { return request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/i.test(name)) }
function cachePolicy(response, pathname, privateResponse = false) {
  if (privateResponse) {
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  if (cacheablePublicPaths.has(pathname)) {
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
    response.headers.set('CDN-Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  } else {
    response.headers.set('Cache-Control', 'no-store')
  }
  return response
}

export async function proxy(request) {
  const nonce = nonceValue()
  const pathname = request.nextUrl.pathname
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') || request.headers.get('cf-ray') || crypto.randomUUID())

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

  if (isUnsafeMethod(request.method) && !csrfExempt.has(pathname)) {
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return forbidden(request, nonce)
    const origin = request.headers.get('origin')
    if (origin && origin !== applicationOrigin(request)) return forbidden(request, nonce, 'Origin is not allowed.')
  }

  const maxBytes = pathname === '/api/media/upload' ? 20_000_000 : pathname === '/api/stripe/webhook' ? 2_000_000 : pathname.startsWith('/api/') ? 256_000 : 2_000_000
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > maxBytes) return secured(NextResponse.json({ error: 'Request payload is too large.' }, { status: 413 }), { request, nonce })

  if (!legacySystemsEnabled()) {
    const destination = legacyRedirectForPath(pathname)
    if (destination) {
      const url = new URL(destination, request.url)
      url.searchParams.set('legacy', 'disabled')
      return secured(cachePolicy(NextResponse.redirect(url, 307), pathname, true), { request, nonce })
    }
    if (isLegacyApiPath(pathname)) {
      return secured(NextResponse.json({ error: 'This legacy Puddle system is disabled in the location-first product.' }, { status: 410 }), { request, nonce })
    }
  }

  const canonicalTarget = (request.method === 'GET' || request.method === 'HEAD')
    ? canonicalPuddleAuthUrl(request.url, process.env.NEXT_PUBLIC_SITE_URL, authCanonicalPaths)
    : null
  if (canonicalTarget) return secured(NextResponse.redirect(canonicalTarget, 307), { request, nonce })

  if (publicNoSessionPaths.has(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname), { request, nonce, staticScripts: staticLandingPaths.has(pathname) })
  }

  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isAuthOnly = authOnlyPaths.includes(pathname)
  const hasAuthFailure = request.nextUrl.searchParams.has('error') || request.nextUrl.searchParams.has('auth_error')
  const needsSession = isProtected || (hasSupabaseAuthCookie(request) && !pathname.startsWith('/api/'))

  if (!needsSession) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(cachePolicy(response, pathname, isAuthOnly), { request, nonce })
  }

  const { response, user, configured } = await updateSession(request, requestHeaders)

  if (isProtected && !configured) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('error', 'Accounts are temporarily unavailable. Please try again later.')
    return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce })
  }
  if (isProtected && !user) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(url)), pathname, true), { request, nonce })
  }
  if (isAuthOnly && user && !hasAuthFailure) return secured(cachePolicy(carriesCookies(response, NextResponse.redirect(new URL('/discover', request.url))), pathname, true), { request, nonce })
  return secured(cachePolicy(response, pathname, Boolean(user) || isProtected || isAuthOnly), { request, nonce })
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'] }
