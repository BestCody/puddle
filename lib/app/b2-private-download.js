const AUTHORIZE_ACCOUNT_URL = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account'
const ACCOUNT_TOKEN_TTL_MS = 23 * 60 * 60 * 1_000
const TOKEN_REFRESH_SKEW_MS = 60_000
const ALLOWED_PREFIXES = Object.freeze(['catalogue/', 'photos/open/'])
const GLOBAL_KEY = '__puddlePrivateB2DownloadV1'

const globalState = globalThis[GLOBAL_KEY] || {
  account: null,
  accountPromise: null,
  tokens: new Map(),
  tokenPromises: new Map()
}
globalState.tokens ||= new Map()
globalState.tokenPromises ||= new Map()
globalThis[GLOBAL_KEY] = globalState

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback))
}

function encodePath(key) {
  return String(key || '').split('/').filter(Boolean)
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/')
}

function normalizedDownloadBase(value, bucket) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (!/(?:^|\.)backblazeb2\.com$/i.test(url.hostname)) return null
    const pathname = url.pathname.replace(/\/+$/, '')
    const expected = `/file/${encodeURIComponent(bucket)}`
    if (pathname !== expected) return null
    url.pathname = pathname
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function b2PrivateDownloadConfiguration(env = process.env) {
  const bucket = String(env.B2_BUCKET || '').trim()
  if (!bucket) return null
  const downloadBaseUrl = normalizedDownloadBase(
    env.B2_DOWNLOAD_BASE_URL || env.B2_PUBLIC_BASE_URL || env.STATIC_CATALOGUE_BASE_URL,
    bucket
  )
  if (!downloadBaseUrl) return null
  return {
    bucket,
    bucketId: String(env.B2_BUCKET_ID || '').trim() || null,
    keyId: String(env.B2_DOWNLOAD_KEY_ID || '').trim(),
    applicationKey: String(env.B2_DOWNLOAD_APPLICATION_KEY || '').trim(),
    downloadBaseUrl,
    tokenTtlSeconds: boundedInteger(env.B2_DOWNLOAD_TOKEN_TTL_SECONDS, 14_400, 60, 604_800)
  }
}

export function managedB2PrefixForKey(key) {
  const normalized = String(key || '').replace(/^\/+/, '')
  return ALLOWED_PREFIXES.find((prefix) => normalized.startsWith(prefix)) || null
}

export function b2ObjectKeyFromUrl(value, config = b2PrivateDownloadConfiguration()) {
  if (!config || !value || String(value).startsWith('/')) return null
  try {
    const base = new URL(`${config.downloadBaseUrl}/`)
    const target = new URL(String(value))
    if (target.protocol !== 'https:' || target.origin !== base.origin || target.username || target.password) return null
    const basePath = base.pathname
    if (!target.pathname.startsWith(basePath)) return null
    const encodedKey = target.pathname.slice(basePath.length)
    if (!encodedKey || encodedKey.startsWith('/')) return null
    const key = encodedKey.split('/').map((segment) => decodeURIComponent(segment)).join('/')
    if (!managedB2PrefixForKey(key)) return null
    return key
  } catch {
    return null
  }
}

export function b2DownloadUrlForKey(key, config = b2PrivateDownloadConfiguration()) {
  const normalized = String(key || '').replace(/^\/+/, '')
  if (!config || !managedB2PrefixForKey(normalized)) return null
  return `${config.downloadBaseUrl}/${encodePath(normalized)}`
}

function responseError(label, response, payload) {
  const code = String(payload?.code || '').slice(0, 80)
  const error = new Error(`${label} failed${code ? ` (${code})` : ''}.`)
  error.status = Number(response?.status || 500)
  error.code = code || null
  return error
}

async function authorizeAccount({ config, fetchImpl, now }) {
  if (!config?.keyId || !config?.applicationKey) {
    throw new Error('Private Backblaze B2 download credentials are not configured.')
  }
  if (globalState.account && globalState.account.cacheKey === `${config.keyId}:${config.bucket}` && globalState.account.expiresAt > now + TOKEN_REFRESH_SKEW_MS) {
    return globalState.account
  }
  if (globalState.accountPromise) return globalState.accountPromise

  globalState.accountPromise = (async () => {
    const basic = Buffer.from(`${config.keyId}:${config.applicationKey}`).toString('base64')
    const response = await fetchImpl(AUTHORIZE_ACCOUNT_URL, {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw responseError('Backblaze account authorization', response, payload)

    const storage = payload?.apiInfo?.storageApi
    const allowed = storage?.allowed || {}
    const capabilities = new Set(Array.isArray(allowed.capabilities) ? allowed.capabilities : [])
    if (!capabilities.has('shareFiles')) throw new Error('The Backblaze download key is missing the shareFiles capability.')
    const allowedBuckets = Array.isArray(allowed.buckets) ? allowed.buckets : []
    const bucketId = config.bucketId || allowedBuckets.find((bucket) => bucket?.name === config.bucket)?.id || null
    if (!bucketId) throw new Error('B2_BUCKET_ID is required when the download key does not expose its restricted bucket ID.')
    if (!storage?.apiUrl || !payload.authorizationToken) throw new Error('Backblaze account authorization returned an incomplete response.')

    const account = {
      cacheKey: `${config.keyId}:${config.bucket}`,
      authorizationToken: payload.authorizationToken,
      apiUrl: String(storage.apiUrl).replace(/\/+$/, ''),
      bucketId,
      expiresAt: now + ACCOUNT_TOKEN_TTL_MS
    }
    globalState.account = account
    return account
  })().finally(() => {
    globalState.accountPromise = null
  })

  return globalState.accountPromise
}

async function requestDownloadAuthorization(prefix, { config, fetchImpl, now, retry = true }) {
  const account = await authorizeAccount({ config, fetchImpl, now })
  const response = await fetchImpl(`${account.apiUrl}/b2api/v4/b2_get_download_authorization`, {
    method: 'POST',
    headers: {
      Authorization: account.authorizationToken,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketId: account.bucketId,
      fileNamePrefix: prefix,
      validDurationInSeconds: config.tokenTtlSeconds
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (retry && response.status === 401 && ['bad_auth_token', 'expired_auth_token'].includes(payload?.code)) {
      globalState.account = null
      return requestDownloadAuthorization(prefix, { config, fetchImpl, now, retry: false })
    }
    throw responseError('Backblaze download authorization', response, payload)
  }
  if (!payload.authorizationToken) throw new Error('Backblaze download authorization returned no token.')
  return {
    authorizationToken: payload.authorizationToken,
    prefix,
    baseUrl: config.downloadBaseUrl,
    expiresAt: now + config.tokenTtlSeconds * 1_000
  }
}

export async function getB2DownloadAuthorization(prefix, {
  config = b2PrivateDownloadConfiguration(),
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  if (!config) throw new Error('Private Backblaze B2 download configuration is incomplete.')
  if (!ALLOWED_PREFIXES.includes(prefix)) throw new Error('The requested Backblaze B2 prefix is not allowed.')
  const cacheKey = `${config.keyId}:${config.bucket}:${prefix}:${config.tokenTtlSeconds}`
  const cached = globalState.tokens.get(cacheKey)
  if (cached && cached.expiresAt > now + TOKEN_REFRESH_SKEW_MS) return cached
  const pending = globalState.tokenPromises.get(cacheKey)
  if (pending) return pending

  const promise = requestDownloadAuthorization(prefix, { config, fetchImpl, now })
    .then((authorization) => {
      globalState.tokens.set(cacheKey, authorization)
      return authorization
    })
    .finally(() => {
      globalState.tokenPromises.delete(cacheKey)
    })
  globalState.tokenPromises.set(cacheKey, promise)
  return promise
}

export async function authorizeB2DownloadUrl(value, {
  config = b2PrivateDownloadConfiguration(),
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  const key = b2ObjectKeyFromUrl(value, config)
  if (!key) return value
  const prefix = managedB2PrefixForKey(key)
  const authorization = await getB2DownloadAuthorization(prefix, { config, fetchImpl, now })
  const url = new URL(b2DownloadUrlForKey(key, config))
  url.searchParams.set('Authorization', authorization.authorizationToken)
  return url.toString()
}

export async function fetchPrivateB2Asset(value, options = {}, {
  config = b2PrivateDownloadConfiguration(),
  fetchImpl = fetch,
  now = Date.now()
} = {}) {
  const url = await authorizeB2DownloadUrl(value, { config, fetchImpl, now })
  return fetchImpl(url, options)
}

export function clearPrivateB2DownloadCacheForTests() {
  globalState.account = null
  globalState.accountPromise = null
  globalState.tokens.clear()
  globalState.tokenPromises.clear()
}

export const b2PrivateDownloadPrefixes = ALLOWED_PREFIXES
