import { authorizeB2, b2ConfigFromEnv, joinB2Key } from '../storage/b2-native.js'
import { createAdminClient } from '../supabase/admin.js'

const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504])
const AUTH_TTL_MS = 20 * 60 * 1000
let cachedAuthorization = null
let cachedRuntimeDataConfig = null

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

function completeConfig(config) {
  return Boolean(config?.keyId && config?.applicationKey && (config?.bucketId || config?.bucketName))
}

export function hasB2SearchCredentialSource(prefix = 'B2_DATA', env = process.env) {
  if (completeConfig(b2ConfigFromEnv(prefix, env))) return true
  if (String(prefix || '').toUpperCase() !== 'B2_DATA') return false
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

async function vaultDataConfig(env) {
  if (cachedRuntimeDataConfig && Date.now() - cachedRuntimeDataConfig.at < AUTH_TTL_MS) {
    return cachedRuntimeDataConfig.value
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('B2_DATA credentials are not configured.')
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('get_b2_data_runtime_auth')
  if (error) throw new Error('B2_DATA runtime credential lookup failed.')
  const config = {
    keyId: String(data?.keyId || '').trim(),
    applicationKey: String(data?.applicationKey || ''),
    bucketId: String(data?.bucketId || '').trim(),
    bucketName: String(data?.bucketName || '').trim()
  }
  if (!completeConfig(config)) throw new Error('B2_DATA runtime credential is not configured.')
  cachedRuntimeDataConfig = { at: Date.now(), value: config }
  return config
}

async function runtimeConfig(prefix, env) {
  const direct = b2ConfigFromEnv(prefix, env)
  if (completeConfig(direct)) return direct
  if (String(prefix || '').toUpperCase() !== 'B2_DATA') return direct
  return vaultDataConfig(env)
}

function resolveBucketName(config, auth) {
  if (config.bucketName) return config.bucketName
  const buckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
  if (config.bucketId) return buckets.find((bucket) => bucket?.id === config.bucketId)?.name || null
  return buckets.length === 1 ? buckets[0]?.name || null : null
}

async function authorization(prefix, env, fetchFn) {
  const config = await runtimeConfig(prefix, env)
  if (!config.keyId || !config.applicationKey) throw new Error(`${prefix} credentials are not configured.`)
  const cacheKey = `${config.keyId}:${config.bucketId || config.bucketName || ''}`
  if (cachedAuthorization?.key === cacheKey && Date.now() - cachedAuthorization.at < AUTH_TTL_MS) return cachedAuthorization.value
  const auth = await authorizeB2({ keyId: config.keyId, applicationKey: config.applicationKey, fetchFn })
  const capabilities = new Set(auth.allowed?.capabilities || [])
  if (capabilities.size && !capabilities.has('readFiles')) throw new Error(`${prefix} application key requires readFiles capability.`)
  const namePrefix = String(auth.allowed?.namePrefix || '')
  if (String(prefix || '').toUpperCase() === 'B2_DATA' && namePrefix && !'data/'.startsWith(namePrefix) && !namePrefix.startsWith('data/')) {
    throw new Error('B2_DATA application key is not authorized for the data namespace.')
  }
  const bucketName = resolveBucketName(config, auth)
  if (!bucketName) throw new Error(`${prefix}_BUCKET_NAME is required for private object downloads.`)
  const value = { auth, bucketName }
  cachedAuthorization = { key: cacheKey, at: Date.now(), value }
  return value
}

function queryWasAborted(signal, error) {
  return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.name === 'TimeoutError'
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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError')
    const { auth, bucketName } = await authorization(prefix, env, fetchFn)
    const url = `${auth.downloadUrl}/file/${encodeURIComponent(bucketName)}/${encodePath(objectKey)}`
    let response
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: auth.authorizationToken, Accept: 'application/octet-stream' },
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

export function clearB2SearchAuthorizationCache() {
  cachedAuthorization = null
  cachedRuntimeDataConfig = null
}
