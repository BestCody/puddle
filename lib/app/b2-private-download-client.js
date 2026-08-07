"use client"

const TOKEN_REFRESH_SKEW_MS = 60_000
const tokenCache = new Map()
const pending = new Map()

function managedObjectKey(key) {
  const value = String(key || '').replace(/^\/+/, '')
  if (!value || value.length > 2_048) return null
  if (!value.startsWith('catalogue/') && !value.startsWith('photos/open/')) return null
  if (value.includes('..') || value.includes('\\') || value.includes('?') || value.includes('#')) return null
  return value
}

function encodePath(key) {
  return String(key || '').split('/').filter(Boolean)
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function validAccessPayload(payload, requestedKey) {
  if (!payload || typeof payload !== 'object' || payload.key !== requestedKey || !payload.authorizationToken) return null
  const expiresAt = new Date(payload.expiresAt).getTime()
  if (!Number.isFinite(expiresAt)) return null
  try {
    const base = new URL(String(payload.baseUrl || ''))
    if (base.protocol !== 'https:' || !/(?:^|\.)backblazeb2\.com$/i.test(base.hostname)) return null
    if (base.username || base.password || base.search || base.hash) return null
    return {
      key: requestedKey,
      baseUrl: base.toString().replace(/\/$/, ''),
      authorizationToken: String(payload.authorizationToken),
      expiresAt
    }
  } catch {
    return null
  }
}

async function requestAccess(key, fetchImpl) {
  const response = await fetchImpl(`/api/storage/b2-access?key=${encodeURIComponent(key)}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Private asset access could not be renewed.')
  const access = validAccessPayload(payload, key)
  if (!access) throw new Error('Private asset access returned an invalid response.')
  tokenCache.set(key, access)
  return access
}

async function accessFor(key, { fetchImpl = fetch, force = false, now = Date.now() } = {}) {
  if (!force) {
    const cached = tokenCache.get(key)
    if (cached && cached.expiresAt > now + TOKEN_REFRESH_SKEW_MS) return cached
  }
  if (pending.has(key)) return pending.get(key)
  const promise = requestAccess(key, fetchImpl).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

export async function privateB2AssetUrl(key, options = {}) {
  const normalized = managedObjectKey(key)
  if (!normalized) throw new Error('The private asset key is outside an allowed prefix.')
  const access = await accessFor(normalized, options)
  const url = new URL(`${access.baseUrl}/${encodePath(normalized)}`)
  url.searchParams.set('Authorization', access.authorizationToken)
  return url.toString()
}

export function clearPrivateB2ClientCacheForTests() {
  tokenCache.clear()
  pending.clear()
}
