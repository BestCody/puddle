import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

// Test-only override lets local/E2E environments point authorization at a
// B2-shaped emulator. Production must leave this unset so the real Backblaze
// endpoint is used.
const AUTHORIZE_URL = String(process.env.B2_AUTHORIZE_ENDPOINT || '').trim() || 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account'
const MAX_SINGLE_FILE_BYTES = 5_000_000_000
const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504])

function text(value) {
  return String(value || '').trim()
}

function required(value, name) {
  const result = text(value)
  if (!result) throw new Error(`${name} is required.`)
  return result
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function retryDelay(attempt, retryAfter = null) {
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000)
  return Math.min(30_000, 750 * (2 ** attempt) + Math.floor(Math.random() * 250))
}

function encodeFileName(value) {
  return encodeURIComponent(String(value || '')).replace(/%2F/gi, '/')
}

export function joinB2Key(...parts) {
  return parts
    .flatMap((part) => String(part || '').split('/'))
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

export function sha1Hex(body) {
  return createHash('sha1').update(body).digest('hex')
}

export function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex')
}

async function responseJson(response, label) {
  const body = await response.text()
  let payload = null
  try { payload = body ? JSON.parse(body) : null } catch {}
  if (!response.ok) {
    const error = new Error(`${label} failed with ${response.status}${payload?.message ? `: ${payload.message}` : ''}.`)
    error.status = response.status
    error.code = payload?.code || null
    error.retryAfter = response.headers.get('retry-after')
    throw error
  }
  return payload || {}
}

export async function authorizeB2({ keyId, applicationKey, fetchFn = fetch } = {}) {
  const credentials = Buffer.from(`${required(keyId, 'B2 application key ID')}:${required(applicationKey, 'B2 application key')}`).toString('base64')
  const response = await fetchFn(AUTHORIZE_URL, {
    headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
    cache: 'no-store'
  })
  const payload = await responseJson(response, 'B2 authorization')
  const storage = payload?.apiInfo?.storageApi
  if (!storage?.apiUrl || !storage?.downloadUrl || !payload?.authorizationToken) {
    throw new Error('B2 authorization response did not include Storage API endpoints.')
  }
  return {
    accountId: payload.accountId,
    authorizationToken: payload.authorizationToken,
    apiUrl: storage.apiUrl,
    downloadUrl: storage.downloadUrl,
    s3ApiUrl: storage.s3ApiUrl || null,
    allowed: storage.allowed || { buckets: [], capabilities: [], namePrefix: null },
    recommendedPartSize: Number(storage.recommendedPartSize || 100_000_000)
  }
}

function configuredBucket(auth, bucketId, bucketName) {
  const id = text(bucketId)
  const name = text(bucketName)
  const allowedBuckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
  if (id) {
    const allowed = allowedBuckets.find((bucket) => bucket?.id === id)
    if (allowedBuckets.length && !allowed) throw new Error('The B2 key is not authorized for the configured bucket ID.')
    return { id, name: name || allowed?.name || null }
  }
  if (name) {
    const allowed = allowedBuckets.find((bucket) => bucket?.name === name)
    if (!allowed?.id) throw new Error('B2 bucket ID is required unless the restricted key exposes the configured bucket name.')
    return { id: allowed.id, name }
  }
  if (allowedBuckets.length === 1 && allowedBuckets[0]?.id) return { id: allowedBuckets[0].id, name: allowedBuckets[0].name || null }
  throw new Error('Configure a B2 bucket ID or use a key restricted to exactly one bucket.')
}

function scopedOrLegacy(env, scopedNames, legacyNames = []) {
  for (const name of [...scopedNames, ...legacyNames]) {
    const value = text(env[name])
    if (value) return value
  }
  return ''
}

export function b2ConfigFromEnv(prefix = 'B2_MEDIA', env = process.env) {
  const normalized = String(prefix || 'B2_MEDIA').replace(/[^A-Z0-9_]/gi, '_').toUpperCase()
  const allowLegacy = normalized === 'B2_DATA' || normalized === 'B2_MEDIA'
  const legacy = (name) => allowLegacy ? [name] : []
  return {
    keyId: scopedOrLegacy(env, [`${normalized}_KEY_ID`, `${normalized}_APPLICATION_KEY_ID`], legacy('B2_KEY_ID')),
    applicationKey: scopedOrLegacy(env, [`${normalized}_APPLICATION_KEY`], legacy('B2_APPLICATION_KEY')),
    bucketId: scopedOrLegacy(env, [`${normalized}_BUCKET_ID`], legacy('B2_BUCKET_ID')),
    bucketName: scopedOrLegacy(env, [`${normalized}_BUCKET_NAME`], legacy('B2_BUCKET'))
  }
}

export function isB2Configured(prefix = 'B2_MEDIA', env = process.env) {
  const config = b2ConfigFromEnv(prefix, env)
  return Boolean(config.keyId && config.applicationKey && (config.bucketId || config.bucketName))
}

export async function createB2BucketClient(config = {}, { fetchFn = fetch } = {}) {
  const keyId = required(config.keyId, 'B2 application key ID')
  const applicationKey = required(config.applicationKey, 'B2 application key')
  let auth = await authorizeB2({ keyId, applicationKey, fetchFn })
  let bucket = configuredBucket(auth, config.bucketId, config.bucketName)

  function ensureCapability(capability) {
    const capabilities = new Set(auth.allowed?.capabilities || [])
    if (capabilities.size && !capabilities.has(capability)) {
      throw new Error(`B2 application key requires the ${capability} capability.`)
    }
  }

  async function refreshAuthorization() {
    auth = await authorizeB2({ keyId, applicationKey, fetchFn })
    bucket = configuredBucket(auth, config.bucketId || bucket.id, config.bucketName || bucket.name)
  }

  async function getUploadUrl() {
    ensureCapability('writeFiles')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetchFn(`${auth.apiUrl}/b2api/v4/b2_get_upload_url`, {
          method: 'POST',
          headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucketId: bucket.id }),
          cache: 'no-store'
        })
        return await responseJson(response, 'B2 get upload URL')
      } catch (error) {
        if (error.status === 401) await refreshAuthorization()
        if (!RETRYABLE.has(Number(error.status)) || attempt === 4) throw error
        await sleep(retryDelay(attempt, error.retryAfter))
      }
    }
    throw new Error('B2 upload URL could not be acquired.')
  }

  function uploader() {
    let uploadSession = null

    async function session() {
      if (!uploadSession) uploadSession = await getUploadUrl()
      return uploadSession
    }

    async function uploadBody({ key, bodyFactory, byteSize, sha1, contentType = 'b2/x-auto', metadata = {} }) {
      const safeKey = joinB2Key(key)
      if (!safeKey) throw new Error('B2 object key is required.')
      if (!Number.isFinite(byteSize) || byteSize < 0 || byteSize > MAX_SINGLE_FILE_BYTES) {
        throw new Error('B2 single-file upload must be between 0 bytes and 5 GB. Partition larger datasets before upload.')
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await session()
        const headers = {
          Authorization: current.authorizationToken,
          'Content-Type': contentType,
          'Content-Length': String(byteSize),
          'X-Bz-File-Name': encodeFileName(safeKey),
          'X-Bz-Content-Sha1': required(sha1, 'B2 content SHA1')
        }
        for (const [name, value] of Object.entries(metadata || {})) {
          if (!/^[A-Za-z0-9_.-]{1,50}$/.test(name) || value === null || value === undefined) continue
          headers[`X-Bz-Info-${name}`] = encodeURIComponent(String(value).slice(0, 1000))
        }
        try {
          const body = bodyFactory()
          const response = await fetchFn(current.uploadUrl, {
            method: 'POST', headers, body, duplex: 'half', cache: 'no-store'
          })
          const result = await responseJson(response, 'B2 upload')
          if (String(result.contentSha1 || '').toLowerCase() !== String(sha1).toLowerCase()) {
            throw new Error('B2 upload checksum did not match the local SHA1.')
          }
          return { ...result, key: safeKey }
        } catch (error) {
          uploadSession = null
          if (!RETRYABLE.has(Number(error.status)) || attempt === 4) throw error
          if (error.status === 401) await refreshAuthorization()
          await sleep(retryDelay(attempt, error.retryAfter))
        }
      }
      throw new Error('B2 upload failed after five upload endpoints.')
    }

    async function uploadBuffer(key, body, options = {}) {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
      return uploadBody({
        key,
        bodyFactory: () => buffer,
        byteSize: buffer.length,
        sha1: sha1Hex(buffer),
        contentType: options.contentType,
        metadata: options.metadata
      })
    }

    async function uploadFile(key, filePath, options = {}) {
      const info = await stat(filePath)
      if (!info.isFile()) throw new Error(`${filePath} is not a regular file.`)
      if (info.size > MAX_SINGLE_FILE_BYTES) throw new Error(`${filePath} exceeds B2's 5 GB single-file limit; partition it first.`)
      const hash = createHash('sha1')
      await new Promise((resolve, reject) => {
        const input = createReadStream(filePath)
        input.on('data', (chunk) => hash.update(chunk))
        input.on('error', reject)
        input.on('end', resolve)
      })
      return uploadBody({
        key,
        bodyFactory: () => Readable.toWeb(createReadStream(filePath)),
        byteSize: info.size,
        sha1: hash.digest('hex'),
        contentType: options.contentType,
        metadata: { src_last_modified_millis: Math.trunc(info.mtimeMs), ...(options.metadata || {}) }
      })
    }

    return { uploadBuffer, uploadFile }
  }

  return {
    bucketId: bucket.id,
    bucketName: bucket.name,
    uploader,
    authorization: () => ({ ...auth, authorizationToken: undefined })
  }
}

export async function createB2BucketClientFromEnv(prefix = 'B2_MEDIA', options = {}) {
  return createB2BucketClient(b2ConfigFromEnv(prefix), options)
}
