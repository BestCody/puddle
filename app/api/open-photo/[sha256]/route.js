import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authorizeB2 } from '@/lib/storage/b2-native'
import { createTraceId, elapsedMs, latencyStart } from '@/lib/performance/server-latency'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const HASH_RE = /^[0-9a-f]{64}$/
const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504])
const CONFIG_TTL_MS = 5 * 60 * 1000
const AUTH_TTL_MS = 60 * 60 * 1000
let configCache = null
let authCache = null
let configInFlight = null
let authInFlight = null

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function encodeB2Key(key) {
  return String(key || '').split('/').map((part) => encodeURIComponent(part)).join('/')
}

function canonicalStorageKey(hash) {
  return `media/photos/by-sha256/${hash.slice(0, 2)}/${hash}.jpg`
}

function serverTiming(entries, totalMs) {
  return [...entries, { name: 'total', durationMs: totalMs }]
    .map(({ name, durationMs }) => `${name};dur=${Math.max(0, Number(durationMs) || 0)}`)
    .join(',')
}

async function runtimeConfig(admin) {
  if (configCache?.expiresAt > Date.now()) return configCache.value
  if (configInFlight) return configInFlight
  const promise = (async () => {
    const { data, error } = await admin.rpc('get_b2_media_runtime_auth')
    if (error) throw error
    const value = data && typeof data === 'object' ? data : null
    if (!value?.keyId || !value?.applicationKey || !value?.bucketName) {
      const unavailable = new Error('Private media runtime authentication is unavailable.')
      unavailable.status = 503
      throw unavailable
    }
    configCache = { value, expiresAt: Date.now() + CONFIG_TTL_MS }
    return value
  })()
  configInFlight = promise
  try {
    return await promise
  } finally {
    if (configInFlight === promise) configInFlight = null
  }
}

async function authorization(config, force = false) {
  const cacheKey = `${config.keyId}:${config.bucketId || ''}:${config.bucketName}`
  if (!force && authCache?.expiresAt > Date.now() && authCache.key === cacheKey) {
    return authCache.value
  }
  if (!force && authInFlight?.key === cacheKey) return authInFlight.promise
  const promise = (async () => {
    const value = await authorizeB2({ keyId: config.keyId, applicationKey: config.applicationKey })
    const capabilities = new Set(value.allowed?.capabilities || [])
    const buckets = Array.isArray(value.allowed?.buckets) ? value.allowed.buckets : []
    if (capabilities.size && !capabilities.has('readFiles')) throw new Error('B2 media key lacks readFiles capability.')
    const matchingBucket = buckets.find((bucket) => {
      const idMatches = !config.bucketId || bucket?.id === config.bucketId
      return idMatches && bucket?.name === config.bucketName
    })
    if (buckets.length && !matchingBucket) {
      throw new Error('B2 media key is not authorized for the configured bucket.')
    }
    authCache = { value, key: cacheKey, bucketId: config.bucketId || matchingBucket?.id || null, expiresAt: Date.now() + AUTH_TTL_MS }
    return value
  })()
  if (!force) authInFlight = { key: cacheKey, promise }
  try {
    return await promise
  } finally {
    if (authInFlight?.promise === promise) authInFlight = null
  }
}

async function downloadPrivateObject(config, key) {
  let auth = await authorization(config)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response
    try {
      response = await fetch(`${auth.downloadUrl}/file/${encodeURIComponent(config.bucketName)}/${encodeB2Key(key)}`, {
        headers: { Authorization: auth.authorizationToken, Accept: 'image/jpeg' },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000)
      })
    } catch (error) {
      if (attempt === 4) throw error
      await sleep(Math.min(5000, 300 * (2 ** attempt)))
      continue
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer())
    if (!RETRYABLE.has(response.status) || attempt === 4) {
      const error = new Error(`Private B2 media download failed with HTTP ${response.status}.`)
      error.status = response.status === 404 ? 404 : 502
      throw error
    }
    if (response.status === 401) auth = await authorization(config, true)
    await sleep(Math.min(5000, 300 * (2 ** attempt)))
  }
  throw new Error('Private B2 media download failed after retries.')
}

export async function GET(_request, { params }) {
  const traceId = createTraceId()
  const startedAt = latencyStart()
  const timings = []
  try {
    const { sha256: rawHash } = await params
    const hash = String(rawHash || '').trim().toLowerCase()
    if (!HASH_RE.test(hash)) {
      const response = NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
      response.headers.set('x-puddle-trace-id', traceId)
      response.headers.set('Server-Timing', serverTiming(timings, elapsedMs(startedAt)))
      return response
    }

    const configStartedAt = latencyStart()
    const config = await runtimeConfig(createAdminClient())
    timings.push({ name: 'config', durationMs: elapsedMs(configStartedAt) })
    const downloadStartedAt = latencyStart()
    const body = await downloadPrivateObject(config, canonicalStorageKey(hash))
    timings.push({ name: 'b2', durationMs: elapsedMs(downloadStartedAt) })
    const verifyStartedAt = latencyStart()
    const actualHash = createHash('sha256').update(body).digest('hex')
    if (actualHash !== hash) throw new Error('Private B2 media failed canonical SHA256 verification.')
    timings.push({ name: 'verify', durationMs: elapsedMs(verifyStartedAt) })

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(body.length),
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `\"sha256-${hash}\"`,
        'X-Content-Type-Options': 'nosniff',
        'x-puddle-trace-id': traceId,
        'Server-Timing': serverTiming(timings, elapsedMs(startedAt))
      }
    })
  } catch (error) {
    const response = NextResponse.json(
      { error: error?.status === 404 ? 'Photo not found.' : 'Photo delivery is temporarily unavailable.' },
      { status: error?.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'private, no-store' } }
    )
    response.headers.set('x-puddle-trace-id', traceId)
    response.headers.set('Server-Timing', serverTiming(timings, elapsedMs(startedAt)))
    console.error(`Open photo delivery failed trace=${traceId}`, error)
    return response
  }
}
