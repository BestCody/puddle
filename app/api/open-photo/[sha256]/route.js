import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authorizeB2 } from '@/lib/storage/b2-native'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const HASH_RE = /^[0-9a-f]{64}$/
const RETRYABLE = new Set([401, 408, 425, 429, 500, 502, 503, 504])

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function encodeB2Key(key) {
  return String(key || '').split('/').map((part) => encodeURIComponent(part)).join('/')
}

function canonicalStorageKey(key, hash) {
  const value = String(key || '')
  return value === `media/photos/by-sha256/${hash.slice(0, 2)}/${hash}.jpg`
}

async function runtimeConfig(admin) {
  const { data, error } = await admin.rpc('get_b2_media_runtime_auth')
  if (error) throw error
  const config = data && typeof data === 'object' ? data : null
  if (!config?.keyId || !config?.applicationKey || !config?.bucketId || !config?.bucketName) {
    const unavailable = new Error('Private media runtime authentication is unavailable.')
    unavailable.status = 503
    throw unavailable
  }
  return config
}

async function downloadPrivateObject(config, key) {
  let auth = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!auth || attempt > 0) {
      auth = await authorizeB2({ keyId: config.keyId, applicationKey: config.applicationKey })
      const capabilities = new Set(auth.allowed?.capabilities || [])
      const buckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
      if (capabilities.size && !capabilities.has('readFiles')) throw new Error('B2 media key lacks readFiles capability.')
      if (buckets.length && !buckets.some((bucket) => bucket?.id === config.bucketId && bucket?.name === config.bucketName)) {
        throw new Error('B2 media key is not authorized for the configured bucket.')
      }
    }

    let response
    try {
      response = await fetch(`${auth.downloadUrl}/file/${encodeURIComponent(config.bucketName)}/${encodeB2Key(key)}`, {
        headers: { Authorization: auth.authorizationToken, Accept: 'image/jpeg' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000)
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
    await sleep(Math.min(5000, 300 * (2 ** attempt)))
  }
  throw new Error('Private B2 media download failed after retries.')
}

export async function GET(_request, { params }) {
  try {
    const { sha256: rawHash } = await params
    const hash = String(rawHash || '').trim().toLowerCase()
    if (!HASH_RE.test(hash)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })

    const admin = createAdminClient()
    const { data: media, error: mediaError } = await admin
      .from('media_objects')
      .select('storage_backend,storage_key,content_hash,byte_size')
      .eq('storage_backend', 'b2')
      .eq('content_hash', hash)
      .maybeSingle()
    if (mediaError) throw mediaError
    if (!media || !canonicalStorageKey(media.storage_key, hash)) {
      return NextResponse.json({ error: 'Photo not found.' }, { status: 404 })
    }

    const config = await runtimeConfig(admin)
    const body = await downloadPrivateObject(config, media.storage_key)
    const actualHash = createHash('sha256').update(body).digest('hex')
    if (body.length !== Number(media.byte_size) || actualHash !== hash) {
      throw new Error('Private B2 media failed canonical byte verification.')
    }

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(body.length),
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `\"sha256-${hash}\"`,
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (error) {
    console.error('Open photo delivery failed', error)
    return NextResponse.json(
      { error: error?.status === 404 ? 'Photo not found.' : 'Photo delivery is temporarily unavailable.' },
      { status: error?.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }
}
