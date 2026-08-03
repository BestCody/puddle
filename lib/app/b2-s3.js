import { createHash, createHmac } from 'node:crypto'

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value, encoding = undefined) {
  return createHmac('sha256', key).update(value).digest(encoding)
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalPath(bucket, key = '') {
  const segments = [bucket, ...String(key).split('/').filter(Boolean)].map(encode)
  return `/${segments.join('/')}${!key ? '/' : ''}`
}

function canonicalQuery(parameters = {}) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function amzTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function endpointConfiguration(value) {
  try {
    const endpoint = new URL(String(value || '').trim())
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null
    if (endpoint.pathname !== '/' && endpoint.pathname !== '') return null
    if (!/^s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(endpoint.hostname)) return null
    const region = endpoint.hostname.split('.')[1]
    return { endpoint: endpoint.origin, host: endpoint.hostname, region }
  } catch {
    return null
  }
}

export function b2Configuration(env = process.env) {
  const endpoint = endpointConfiguration(env.B2_S3_ENDPOINT)
  const accessKeyId = String(env.B2_KEY_ID || '').trim()
  const secretAccessKey = String(env.B2_APPLICATION_KEY || '').trim()
  const bucket = String(env.B2_BUCKET || '').trim()
  const publicBaseUrl = String(env.B2_PUBLIC_BASE_URL || env.NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL || '').replace(/\/+$/, '')
  const configuredRegion = String(env.B2_REGION || '').trim()
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null
  if (configuredRegion && configuredRegion !== endpoint.region) return null
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    endpoint: endpoint.endpoint,
    host: endpoint.host,
    region: endpoint.region
  }
}

export function b2PublicUrl(key, config = b2Configuration()) {
  if (!config?.publicBaseUrl) return null
  return `${config.publicBaseUrl}/${String(key).split('/').filter(Boolean).map(encode).join('/')}`
}

export function signB2Request({
  method = 'GET',
  key = '',
  query = {},
  headers = {},
  body = Buffer.alloc(0),
  now = new Date(),
  config = b2Configuration()
} = {}) {
  if (!config) throw new Error('Backblaze B2 credentials are not configured.')
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body || '')
  const payloadHash = hash(content)
  const timestamp = amzTimestamp(now)
  const date = timestamp.slice(0, 8)
  const normalizedHeaders = Object.fromEntries(Object.entries({
    host: config.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': timestamp,
    ...headers
  }).map(([name, value]) => [String(name).toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')]))
  const signedHeaderNames = Object.keys(normalizedHeaders).sort()
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${normalizedHeaders[name]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')
  const path = canonicalPath(config.bucket, key)
  const queryString = canonicalQuery(query)
  const canonicalRequest = [
    String(method).toUpperCase(),
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')
  const scope = `${date}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    hash(canonicalRequest)
  ].join('\n')
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date)
  const regionKey = hmac(dateKey, config.region)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = hmac(signingKey, stringToSign, 'hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const url = `${config.endpoint}${path}${queryString ? `?${queryString}` : ''}`
  return {
    url,
    headers: {
      ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value)])),
      Host: config.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
      Authorization: authorization
    },
    body: content,
    canonicalRequest,
    stringToSign
  }
}

export async function b2Request(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const signed = signB2Request(options)
  return fetchImpl(signed.url, {
    method: String(options.method || 'GET').toUpperCase(),
    headers: signed.headers,
    body: ['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()) ? undefined : signed.body,
    redirect: 'error',
    signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs || 30_000))
  })
}

export async function putB2Object(key, body, {
  contentType = 'application/octet-stream',
  contentEncoding = null,
  cacheControl = 'public, max-age=31536000, immutable',
  metadata = {},
  config = b2Configuration(),
  fetchImpl = fetch
} = {}) {
  const headers = {
    'content-type': contentType,
    'cache-control': cacheControl,
    ...Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${String(name).toLowerCase()}`, String(value)]))
  }
  if (contentEncoding) headers['content-encoding'] = contentEncoding
  const response = await b2Request({ method: 'PUT', key, body, headers, config, fetchImpl })
  if (!response.ok) throw new Error(`Backblaze B2 upload failed for ${key}: ${response.status} ${await response.text()}`)
  return { key, etag: response.headers.get('etag'), publicUrl: b2PublicUrl(key, config) }
}

export async function headB2Object(key, { config = b2Configuration(), fetchImpl = fetch } = {}) {
  const response = await b2Request({ method: 'HEAD', key, config, fetchImpl })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Backblaze B2 HEAD failed for ${key}: ${response.status}`)
  return { key, etag: response.headers.get('etag'), bytes: Number(response.headers.get('content-length') || 0) }
}

export async function deleteB2Object(key, { config = b2Configuration(), fetchImpl = fetch } = {}) {
  const response = await b2Request({ method: 'DELETE', key, config, fetchImpl })
  if (!response.ok && response.status !== 404) throw new Error(`Backblaze B2 delete failed for ${key}: ${response.status} ${await response.text()}`)
  return { key, deleted: response.status !== 404 }
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export async function listB2Objects(prefix = '', {
  config = b2Configuration(),
  fetchImpl = fetch,
  maxKeys = 1_000,
  continuationToken = null
} = {}) {
  const query = {
    'list-type': '2',
    prefix,
    'max-keys': Math.max(1, Math.min(1_000, Number(maxKeys) || 1_000))
  }
  if (continuationToken) query['continuation-token'] = continuationToken
  const response = await b2Request({ method: 'GET', key: '', query, config, fetchImpl })
  if (!response.ok) throw new Error(`Backblaze B2 list failed: ${response.status} ${await response.text()}`)
  const xml = await response.text()
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const content = match[1]
    return {
      key: decodeXml(content.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]),
      bytes: Number(content.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
      lastModified: content.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || null,
      etag: decodeXml(content.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1])
    }
  })
  return {
    objects,
    truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    nextContinuationToken: decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1]) || null
  }
}
