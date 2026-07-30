const INTERNAL_ORIGIN = 'https://puddle.internal'
const ENCODED_SEPARATORS = /%(?:2f|5c)/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function safeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string') return fallback
  const candidate = value.trim()
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback
  if (candidate.includes('\\') || CONTROL_CHARACTERS.test(candidate) || ENCODED_SEPARATORS.test(candidate)) return fallback

  try {
    const parsed = new URL(candidate, INTERNAL_ORIGIN)
    if (parsed.origin !== INTERNAL_ORIGIN || parsed.username || parsed.password || parsed.pathname.startsWith('//')) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function pathWithMessage(path, kind, message, extra = {}) {
  const safePath = safeNextPath(path, '/dashboard')
  const params = new URLSearchParams({ [kind]: String(message).slice(0, 500), ...extra })
  return `${safePath}${safePath.includes('?') ? '&' : '?'}${params.toString()}`
}
