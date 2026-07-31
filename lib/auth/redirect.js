const INTERNAL_ORIGIN = 'https://puddle.internal'
const ENCODED_SEPARATORS = /%(?:2f|5c)/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function safeNextPath(value, fallback = '/discover') {
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
  const target = new URL(safeNextPath(path, '/discover'), INTERNAL_ORIGIN)
  target.searchParams.set(String(kind), String(message).slice(0, 500))
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value).slice(0, 500))
  }
  return `${target.pathname}${target.search}${target.hash}`
}
