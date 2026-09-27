import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

let cachedClient = null
let cachedConfig = null

function required(value, name) {
  const result = String(value || '').trim()
  if (!result) throw new Error(`${name} is required for self-hosted object storage.`)
  return result
}

export function selfHostObjectConfig(env = process.env) {
  const endpoint = required(env.OBJECT_STORAGE_ENDPOINT, 'OBJECT_STORAGE_ENDPOINT')
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('OBJECT_STORAGE_ENDPOINT must be a bare HTTP(S) origin.')
  }
  return {
    endpoint: url.origin,
    region: required(env.OBJECT_STORAGE_REGION, 'OBJECT_STORAGE_REGION'),
    bucket: required(env.OBJECT_STORAGE_BUCKET, 'OBJECT_STORAGE_BUCKET'),
    accessKeyId: required(env.OBJECT_STORAGE_ACCESS_KEY_ID, 'OBJECT_STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: required(env.OBJECT_STORAGE_SECRET_ACCESS_KEY, 'OBJECT_STORAGE_SECRET_ACCESS_KEY')
  }
}

export function isSelfHostObjectStore(env = process.env) {
  return env.PUDDLE_OBJECT_STORE === 's3'
}

function clientFor(config) {
  const fingerprint = [config.endpoint, config.region, config.accessKeyId, config.secretAccessKey].join('\n')
  if (cachedClient && cachedConfig === fingerprint) return cachedClient
  cachedClient?.destroy()
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 4
  })
  cachedClient = client
  cachedConfig = fingerprint
  return client
}

function isMissing(error) {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404
}

export async function downloadSelfHostObject(key, {
  env = process.env,
  maxBytes = 32 * 1024 * 1024,
  missingOk = false,
  signal,
  client
} = {}) {
  const objectKey = required(key, 'Object key').replace(/^\/+/, '')
  const config = selfHostObjectConfig(env)
  const byteLimit = Number(maxBytes)
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new Error('Object byte limit must be a positive integer.')
  let result
  try {
    result = await (client || clientFor(config)).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      { abortSignal: signal }
    )
  } catch (error) {
    if (missingOk && isMissing(error)) return null
    throw error
  }
  if (Number(result.ContentLength) > byteLimit) {
    result.Body?.destroy?.()
    throw new Error(`Object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
  }
  const chunks = []
  let length = 0
  for await (const chunk of result.Body) {
    length += chunk.length
    if (length > byteLimit) {
      result.Body?.destroy?.()
      throw new Error(`Object ${objectKey} exceeds the ${byteLimit}-byte fetch budget.`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, length)
}

export function resetSelfHostObjectClientForTests() {
  cachedClient?.destroy()
  cachedClient = null
  cachedConfig = null
}
