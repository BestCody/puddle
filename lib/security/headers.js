function cleanOrigin(value) { try { return new URL(value).origin } catch { return null } }
export function applicationOrigin(request) { return cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL) || new URL(request.url).origin }
export function allowedCorsOrigins(request) {
  return new Set([applicationOrigin(request), ...String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((item) => cleanOrigin(item.trim())).filter(Boolean)])
}
export function corsOrigin(request) {
  const origin = cleanOrigin(request.headers.get('origin'))
  return origin && allowedCorsOrigins(request).has(origin) ? origin : null
}
export function nonceValue() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
export function cspValue({ nonce, staticScripts = false, allowSameOriginFrame = false }) {
  const supabase = cleanOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const catalogue = cleanOrigin(
    process.env.B2_DOWNLOAD_BASE_URL || process.env.STATIC_CATALOGUE_BASE_URL || process.env.B2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL
  )
  const insecureLoopbackCatalogue = process.env.STATIC_CATALOGUE_ALLOW_INSECURE_LOCALHOST === 'true' && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(catalogue || '')
  const googleConnections = ['https://maps.googleapis.com', 'https://places.googleapis.com', 'https://maps.gstatic.com']
  const connect = ["'self'", 'https://challenges.cloudflare.com', supabase, catalogue, ...googleConnections].filter(Boolean).join(' ')
  const images = ["'self'", 'data:', 'blob:', supabase, 'https:', catalogue].filter(Boolean).join(' ')
  const media = ["'self'", 'blob:', supabase, 'https:', catalogue].filter(Boolean).join(' ')
  const scriptHosts = 'https://challenges.cloudflare.com https://maps.googleapis.com https://maps.gstatic.com'
  const scripts = staticScripts
    ? `script-src 'self' ${scriptHosts}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${scriptHosts}`
  return [
    "default-src 'self'",
    scripts,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    `img-src ${images}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connect}`,
    "frame-src 'self' https://challenges.cloudflare.com https://www.google.com",
    `media-src ${media}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    `frame-ancestors ${allowSameOriginFrame ? "'self'" : "'none'"}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    insecureLoopbackCatalogue ? null : 'upgrade-insecure-requests',
    'report-uri /api/security/csp-report',
    'report-to csp-endpoint'
  ].filter(Boolean).join('; ')
}
export function applySecurityHeaders(response, { nonce, request, staticScripts = false }) {
  const pathname = request.nextUrl.pathname
  const embeddedSettings = pathname === '/account' && request.nextUrl.searchParams.get('embedded') === '1'
  const allowSameOriginFrame = embeddedSettings || pathname === '/landing-demo' || pathname.startsWith('/landing-demo/')
  response.headers.set('Content-Security-Policy', cspValue({ nonce, staticScripts, allowSameOriginFrame }))
  response.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/security/csp-report"')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', allowSameOriginFrame ? 'SAMEORIGIN' : 'DENY')
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-site')
  if (process.env.NODE_ENV === 'production') response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  const origin = corsOrigin(request)
  if (origin && pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Vary', 'Origin')
  }
  return response
}
