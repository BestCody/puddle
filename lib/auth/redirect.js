export function safeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function pathWithMessage(path, kind, message, extra = {}) {
  const params = new URLSearchParams({ [kind]: message, ...extra })
  return `${path}?${params.toString()}`
}
