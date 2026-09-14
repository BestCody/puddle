import { authorizeB2, b2ConfigFromEnv, joinB2Key } from '../storage/b2-native.js'
import {
  isImmutableB2SearchObject,
  queueB2RuntimeObjectCacheWrite,
  readB2RuntimeObjectCache
} from './b2-runtime-object-cache.js'

const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504])
const AUTH_TTL_MS = 20 * 60 * 1000
const DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 4 * 60 * 60
const REQUIRED_DATA_PREFIX = 'data/search/'
let cachedAuthorization = null
let authorizationInFlight = null
const objectDownloadInFlight = new Map()

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function retryDelay(attempt, retryAfter = null) {
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1000)
  return Math.min(10_000, 350 * (2 ** attempt) + Math.floor(Math.random() * 100))
}

function encodePath(value) {
  return String(value || '').split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

function publicSearchObjectUrl(objectKey, env) {
  if (!isImmutableB2SearchObject(objectKey, env)) return null
  const configured = String(env.GLOBAL_LOCATION_SEARCH_CDN_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!configured) return null
  let base
  try {
    base = new URL(configured)
  } catch {
    throw new Error('GLOBAL_LOCATION_SEARCH_CDN_BASE_URL must be an absolute HTTPS URL.')
  }
  if (base.protocol !== 'https:') throw new Error('GLOBAL_LOCATION_SEARCH_CDN_BASE_URL must use HTTPS.')
  return `${configured}/${encodePath(objectKey)}`
}

function completeConfig(config) {
  return Boolean(config?.keyId && config?.applicationKey && (config?.bucketId || config?.bucketName))
}

function normalizedDownloadBaseUrl(value, bucketName) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    if (!/(?:^|\.)backblazeb2\.com$/i.test(url.hostname)) return null
    const pathname = url.pathname.replace(/\/+$/, '')
    const expected = `/file/${encodeURIComponent(String(bucketName || '').trim())}`
    if (!String(bucketName || '').trim() || pathname !== expected) return null
    url.pathname = pathname
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function downloadConfig(env) {
  const config = {
    keyId: String(env.B2_DOWNLOAD_KEY_ID || '').trim(),
    applicationKey: String(env.B2_DOWNLOAD_APPLICATION_KEY || '').trim(),
    bucketId: String(env.B2_BUCKET_ID || '').trim(),
    bucketName: String(env.B2_BUCKET || '').trim(),
    downloadBaseUrl: normalizedDownloadBaseUrl(env.B2_DOWNLOAD_BASE_URL, env.B2_BUCKET),
    authorizationMode: 'download'
  }
  return completeConfig(config) && config.downloadBaseUrl ? config : null
}

function dataConfig(env) {
  const direct = b2ConfigFromEnv('B2_DATA', env)
  if (completeConfig(direct)) return { ...direct, authorizationMode: 'account' }
  return downloadConfig(env)
}

export function hasB2SearchCredentialSource(prefix = 'B2_DATA', env = process.env) {
  if (String(prefix || '').toUpperCase() === 'B2_DATA' && dataConfig(env)) return true
  if (String(prefix || '').toUpperCase() !== 'B2_DATA' && completeConfig(b2ConfigFromEnv(prefix, env))) return true
  return false
}

async function runtimeConfig(prefix, env) {
  const direct = String(prefix || '').toUpperCase() === 'B2_DATA'
    ? dataConfig(env)
    : b2ConfigFromEnv(prefix, env)
  if (!completeConfig(direct)) throw new Error(`${prefix} credentials are not configured.`)
  return direct
}

function resolveBucketName(config, auth) {
  if (config.bucketName) return config.bucketName
  const buckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
  if (config.bucketId) return buckets.find((bucket) => bucket?.id === config.bucketId)?.name || null
  return buckets.length === 1 ? buckets[0]?.name || null : null
}

function resolveBucketId(config, auth) {
  if (config.bucketId) return config.bucketId
  const buckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
  return buckets.find((bucket) => bucket?.name === config.bucketName)?.id || null
}

function downloadTokenTtlSeconds(env) {
  const parsed = Number(env.B2_DOWNLOAD_TOKEN_TTL_SECONDS)
  if (!Number.isFinite(parsed)) return DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS
  return Math.max(60, Math.min(7 * 24 * 60 * 60, Math.trunc(parsed)))
}

async function issueDataDownloadAuthorization(config, auth, env, fetchFn) {
  const bucketId = resolveBucketId(config, auth)
  if (!bucketId) throw new Error('B2 data download authorization requires a bucket ID.')
  const response = await fetchFn(`${String(auth.apiUrl).replace(/\/+$/, '')}/b2api/v4/b2_get_download_authorization`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketId,
      fileNamePrefix: REQUIRED_DATA_PREFIX,
      validDurationInSeconds: downloadTokenTtlSeconds(env)
    }),
    cache: 'no-store'
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(`B2 data download authorization returned ${response.status}.`)
    error.status = response.status
    error.code = payload?.code || null
    throw error
  }
  if (!payload?.authorizationToken) throw new Error('B2 data download authorization returned no token.')
  return { ...auth, authorizationToken: payload.authorizationToken }
}

async function authorization(prefix, env, fetchFn) {
  const config = await runtimeConfig(prefix, env)
  if (!config.keyId || !config.applicationKey) throw new Error(`${prefix} credentials are not configured.`)
  const cacheKey = `${String(prefix || '').toUpperCase()}:${config.authorizationMode || 'account'}:${config.keyId}:${config.bucketId || ''}:${config.bucketName || ''}`
  if (cachedAuthorization?.key === cacheKey && Date.now() - cachedAuthorization.at < AUTH_TTL_MS) return cachedAuthorization.value
  if (
    authorizationInFlight?.key === cacheKey &&
    authorizationInFlight?.env === env &&
    authorizationInFlight?.fetchFn === fetchFn
  ) return authorizationInFlight.promise

  const promise = (async () => {
    const auth = await authorizeB2({
      keyId: config.keyId,
      applicationKey: config.applicationKey,
      env,
      fetchFn
    })
    const capabilities = new Set(auth.allowed?.capabilities || [])
    // Private downloads must use a prefix-scoped token even when the key also has
    // readFiles. The account authorization token is not a file-download token for
    // private buckets; shareFiles is the capability that permits issuing one.
    const usesDownloadAuthorization = config.authorizationMode === 'download'
    if (capabilities.size) {
      const requiredCapability = usesDownloadAuthorization ? 'shareFiles' : 'readFiles'
      if (!capabilities.has(requiredCapability)) {
        throw new Error(`${prefix} application key requires the ${requiredCapability} capability.`)
      }
    }
    const namePrefix = String(auth.allowed?.namePrefix || '')
    if (
      String(prefix || '').toUpperCase() === 'B2_DATA' &&
      namePrefix &&
      !REQUIRED_DATA_PREFIX.startsWith(namePrefix) &&
      !namePrefix.startsWith(REQUIRED_DATA_PREFIX)
    ) {
      throw new Error('B2_DATA application key is not authorized for the data/search namespace.')
    }
    const bucketName = resolveBucketName(config, auth)
    if (!bucketName) throw new Error(`${prefix}_BUCKET_NAME is required for private object downloads.`)
    const effectiveAuth = usesDownloadAuthorization
      ? await issueDataDownloadAuthorization(config, auth, env, fetchFn)
      : auth
    const value = {
      auth: effectiveAuth,
      bucketName,
      authorizationMode: config.authorizationMode,
      downloadBaseUrl: config.downloadBaseUrl || null
    }
    cachedAuthorization = { key: cacheKey, at: Date.now(), value }
    return value
  })()
  authorizationInFlight = { key: cacheKey, env, fetchFn, promise }
  try {
    return await promise
  } finally {
    if (authorizationInFlight?.promise === promise) authorizationInFlight = null
  }
}

function queryWasAborted(signal, error) {
  return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

async function fetchB2SearchObjectFromOrigin(objectKey, {
  prefix,
  env,
  fetchFn,
  byteLimit,
  signal,
  missingOk
}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError')
    const publicUrl = publicSearchObjectUrl(objectKey, env)
    const authorizationResult = publicUrl ? null : await authorization(prefix, env, fetchFn)
    const url = publicUrl || `${authorizationResult.auth.downloadUrl}/file/${encodeURIComponent(authorizationResult.bucketName)}/${encodePath(objectKey)}`
    let response
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: publicUrl
          ? { Accept: 'application/octet-stream' }
          : { Authorization: authorizationResult.auth.authorizationToken, Accept: 'application/octet-stream' },
        cache: 'no-store',
        redirect: 'error',
        signal
      })
    } catch (error) {
      if (queryWasAborted(signal, error) || attempt === 3) throw error
      await sleep(retryDelay(attempt))
      continue
    }

    if (response.status === 404 && missingOk) return null
    if (!response.ok) {
      if (response.status === 401) cachedAuthorization = null
      const error = new Error(`B2 search object ${objectKey} returned ${response.status}.`)
      error.status = response.status
      if (!RETRYABLE.has(response.status) || attempt === 3) throw error
      await sleep(retryDelay(attempt, response.headers.get('retry-after')))
      continue
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > byteLimit) throw new Error(`B2 search object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > byteLimit) throw new Error(`B2 search object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
    return body
  }
  throw new Error(`B2 search object ${objectKey} could not be downloaded.`)
}

export async function downloadB2SearchObject(key, {
  prefix = 'B2_DATA',
  env = process.env,
  fetchFn = fetch,
  maxBytes = 32 * 1024 * 1024,
  signal = undefined,
  missingOk = false
} = {}) {
  const objectKey = joinB2Key(key)
  if (!objectKey) throw new Error('B2 search object key is required.')
  const byteLimit = Math.max(1, Number(maxBytes) || 1)

  const inFlightKey = `${prefix}:${objectKey}:${byteLimit}:${missingOk ? 'missing' : 'required'}`
  const existing = objectDownloadInFlight.get(inFlightKey)
  if (existing?.env === env && existing?.fetchFn === fetchFn) return existing.promise

  const promise = (async () => {
    const cached = await readB2RuntimeObjectCache(objectKey, { env, fetchFn, maxBytes: byteLimit })
    if (cached !== null) return cached

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError')
      const publicUrl = publicSearchObjectUrl(objectKey, env)
      const authorizationResult = publicUrl ? null : await authorization(prefix, env, fetchFn)
      const url = publicUrl || (
        authorizationResult.authorizationMode === 'download'
          ? `${authorizationResult.downloadBaseUrl}/${encodePath(objectKey)}`
          : `${authorizationResult.auth.downloadUrl}/file/${encodeURIComponent(authorizationResult.bucketName)}/${encodePath(objectKey)}`
      )
      let response
      try {
        response = await fetchFn(url, {
          method: 'GET',
          headers: publicUrl
            ? { Accept: 'application/octet-stream' }
            : { Authorization: authorizationResult.auth.authorizationToken, Accept: 'application/octet-stream' },
          cache: 'no-store',
          redirect: 'error',
          signal
        })
      } catch (error) {
        // Once the query deadline has expired the same AbortSignal can never succeed on retry.
        // Return the timeout immediately instead of adding exponential-backoff delay to a dead request.
        if (queryWasAborted(signal, error) || attempt === 3) throw error
        await sleep(retryDelay(attempt))
        continue
      }

      if (response.status === 404 && missingOk) return null
      if (!response.ok) {
        if (response.status === 401) cachedAuthorization = null
        const payload = await response.clone().json().catch(() => ({}))
        const code = String(payload?.code || '').trim()
        const error = new Error(`B2 search object ${objectKey} returned ${response.status}${code ? ` (${code})` : ''}.`)
        error.status = response.status
        error.code = code || null
        if (!RETRYABLE.has(response.status) || attempt === 3) throw error
        await sleep(retryDelay(attempt, response.headers.get('retry-after')))
        continue
      }

      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > byteLimit) throw new Error(`B2 search object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length > byteLimit) throw new Error(`B2 search object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
      // Runtime Cache is only an accelerator. Populate it after the response path so cold B2 reads
      // do not become slower merely because we are warming future requests.
      if (!isImmutableB2SearchObject(objectKey, env)) {
        queueB2RuntimeObjectCacheWrite(objectKey, body, { env, fetchFn })
      }
      return body
    }
    throw new Error(`B2 search object ${objectKey} could not be downloaded.`)
  })()
  objectDownloadInFlight.set(inFlightKey, { env, fetchFn, promise })
  try {
    return await promise
  } finally {
    if (objectDownloadInFlight.get(inFlightKey)?.promise === promise) objectDownloadInFlight.delete(inFlightKey)
  }
}

export function clearB2SearchAuthorizationCache() {
  cachedAuthorization = null
  authorizationInFlight = null
  objectDownloadInFlight.clear()
}
