import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { allowedCorsOrigins, applySecurityHeaders, applicationOrigin, nonceValue } from '@/lib/security/headers'
import { isUnsafeMethod } from '@/lib/security/request'
import { normalizeOrigin } from '@/lib/auth/origin'

const protectedPrefixes = ['/dashboard','/discover','/explore','/plans','/create','/studio','/report','/friends','/inbox','/notifications','/profile','/onboarding','/account','/wallet','/orders','/settings','/appeals','/admin']
const authOnlyPaths = ['/signin','/signup','/forgot-password']
const csrfExempt = new Set(['/api/stripe/webhook'])
const staticLandingPaths = new Set(['/','/landing.html','/index.html','/responsive-landing'])
const authCanonicalPaths = new Set(['/signin','/signup','/forgot-password','/verify-email','/update-password','/auth/callback','/auth/confirm','/auth/error'])
const publicNoSessionPaths = new Set([...staticLandingPaths, '/privacy', '/terms', '/verify-email', '/auth/callback', '/auth/confirm', '/auth/error'])

function carriesCookies(source, target) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie.name, cookie.value, cookie)
  return target
}

function secured(response, context) { return applySecurityHeaders(response, context) }
function forbidden(request, nonce, message = 'Cross-site request blocked.') { return secured(NextResponse.json({ error: message }, { status: 403 }), { request, nonce }) }
function isPuddleHost(hostname) { return hostname === 'puddle.you' || hostname === 'www.puddle.you' }

function canonicalAuthTarget(request, pathname) {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !authCanonicalPaths.has(pathname)) return null
  const configuredOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  const currentOrigin = normalizeOrigin(request.nextUrl.origin)
  if (!configuredOrigin || !currentOrigin || configuredOrigin === currentOrigin) return null

  const configured = new URL(configuredOrigin)
  const current = new URL(currentOrigin)
  if (!isPuddleHost(configured.hostname) || !isPuddleHost(current.hostname)) return null

  return new URL(`${pathname}${request.nextUrl.search}`, configuredOrigin)
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

  const canonicalTarget = canonicalAuthTarget(request, pathname)
  if (canonicalTarget) return secured(NextResponse.redirect(canonicalTarget, 307), { request, nonce })

  if (publicNoSessionPaths.has(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    return secured(response, { request, nonce, staticScripts: staticLandingPaths.has(pathname) })
  }

  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isAuthOnly = authOnlyPaths.includes(pathname)
  const { response, user, configured } = await updateSession(request, requestHeaders)

  if (isProtected && !configured) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('error', 'Accounts are temporarily unavailable. Please try again later.')
    return secured(carriesCookies(response, NextResponse.redirect(url)), { request, nonce })
  }
  if (isProtected && !user) {
    const url = new URL('/signin', request.url)
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return secured(carriesCookies(response, NextResponse.redirect(url)), { request, nonce })
  }
  if (isAuthOnly && user) return secured(carriesCookies(response, NextResponse.redirect(new URL('/discover', request.url))), { request, nonce })
  return secured(response, { request, nonce, staticScripts: staticLandingPaths.has(pathname) })
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'] }
