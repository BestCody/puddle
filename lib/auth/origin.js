function headerValue(headersLike, name) {
  if (!headersLike) return ''
  const value = typeof headersLike.get === 'function'
    ? headersLike.get(name)
    : headersLike[name] || headersLike[name.toLowerCase()]
  return String(value || '').split(',')[0].trim()
}

export function normalizeOrigin(value) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function requestOrigin(headersLike, fallback = 'http://localhost:3000') {
  const forwardedHost = headerValue(headersLike, 'x-forwarded-host')
  const host = forwardedHost || headerValue(headersLike, 'host')
  const forwardedProto = headerValue(headersLike, 'x-forwarded-proto')
  const protocol = forwardedProto || (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https')
  const hostOrigin = host ? normalizeOrigin(`${protocol}://${host}`) : null
  const originHeader = normalizeOrigin(headerValue(headersLike, 'origin'))

  if (hostOrigin && originHeader && new URL(hostOrigin).host === new URL(originHeader).host) {
    return originHeader
  }

  return hostOrigin || originHeader || normalizeOrigin(fallback) || 'http://localhost:3000'
}

export function siteOrigin(headersLike) {
  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL is required for production authentication URLs')
  }
  return requestOrigin(headersLike)
}

export function siteUrl(headersLike, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Authentication redirects require a local path')
  }
  return new URL(path, siteOrigin(headersLike))
}

function isPuddleHost(hostname) {
  return hostname === 'puddle.you' || hostname === 'www.puddle.you'
}

export function canonicalPuddleAuthUrl(currentUrl, configuredSiteUrl, allowedPaths) {
  const configuredOrigin = normalizeOrigin(configuredSiteUrl)
  if (!configuredOrigin) return null

  let current
  try {
    current = new URL(currentUrl)
  } catch {
    return null
  }

  if (!allowedPaths?.has(current.pathname) || current.origin === configuredOrigin) return null
  const configured = new URL(configuredOrigin)
  if (!isPuddleHost(configured.hostname) || !isPuddleHost(current.hostname)) return null

  return new URL(`${current.pathname}${current.search}`, configuredOrigin)
}
