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
export function cspValue({ nonce, staticScripts = false }) {
  const supabase = cleanOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const connect = ["'self'", 'https://challenges.cloudflare.com', 'https://maps.googleapis.com', 'https://places.googleapis.com', supabase].filter(Boolean).join(' ')
  const scripts = staticScripts
    ? "script-src 'self' https://challenges.cloudflare.com"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`
  return [
    "default-src 'self'",
    scripts,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connect}`,
    "frame-src https://challenges.cloudflare.com",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
    'report-uri /api/security/csp-report',
    'report-to csp-endpoint'
  ].join('; ')
}
export function applySecurityHeaders(response, { nonce, request, staticScripts = false }) {
  response.headers.set('Content-Security-Policy', cspValue({ nonce, staticScripts }))
  response.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/security/csp-report"')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-site')
  if (process.env.NODE_ENV === 'production') response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  const origin = corsOrigin(request)
  if (origin && request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Vary', 'Origin')
  }
  return response
}
