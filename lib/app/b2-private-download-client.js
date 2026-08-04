"use client"

const TOKEN_REFRESH_SKEW_MS = 60_000
const tokenCache = new Map()
const pending = new Map()

function prefixName(key) {
  const value = String(key || '').replace(/^\/+/, '')
  if (value.startsWith('catalogue/')) return 'catalogue'
  if (value.startsWith('photos/open/')) return 'photos'
  return null
}

function encodePath(key) {
  return String(key || '').split('/').filter(Boolean)
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function validAccessPayload(payload, requestedPrefix) {
  if (!payload || typeof payload !== 'object') return null
  const prefix = requestedPrefix === 'catalogue' ? 'catalogue/' : requestedPrefix === 'photos' ? 'photos/open/' : null
  if (!prefix || payload.prefix !== prefix || !payload.authorizationToken) return null
  const expiresAt = new Date(payload.expiresAt).getTime()
  if (!Number.isFinite(expiresAt)) return null
  try {
    const base = new URL(String(payload.baseUrl || ''))
    if (base.protocol !== 'https:' || !/(?:^|\.)backblazeb2\.com$/i.test(base.hostname)) return null
    if (base.username || base.password || base.search || base.hash) return null
    return {
      prefix,
      baseUrl: base.toString().replace(/\/$/, ''),
      authorizationToken: String(payload.authorizationToken),
      expiresAt
    }
  } catch {
    return null
  }
}

async function requestAccess(name, fetchImpl) {
  const response = await fetchImpl(`/api/storage/b2-access?prefix=${encodeURIComponent(name)}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Private asset access could not be renewed.')
  const access = validAccessPayload(payload, name)
  if (!access) throw new Error('Private asset access returned an invalid response.')
  tokenCache.set(name, access)
  return access
}

async function accessFor(name, { fetchImpl = fetch, force = false, now = Date.now() } = {}) {
  if (!force) {
    const cached = tokenCache.get(name)
    if (cached && cached.expiresAt > now + TOKEN_REFRESH_SKEW_MS) return cached
  }
  if (pending.has(name)) return pending.get(name)
  const promise = requestAccess(name, fetchImpl).finally(() => pending.delete(name))
  pending.set(name, promise)
  return promise
}

export async function privateB2AssetUrl(key, options = {}) {
  const normalized = String(key || '').replace(/^\/+/, '')
  const name = prefixName(normalized)
  if (!name) throw new Error('The private asset key is outside an allowed prefix.')
  const access = await accessFor(name, options)
  if (!normalized.startsWith(access.prefix)) throw new Error('The private asset key does not match its authorization prefix.')
  const url = new URL(`${access.baseUrl}/${encodePath(normalized)}`)
  url.searchParams.set('Authorization', access.authorizationToken)
  return url.toString()
}

export function clearPrivateB2ClientCacheForTests() {
  tokenCache.clear()
  pending.clear()
}
