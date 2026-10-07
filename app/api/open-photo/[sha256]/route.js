import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createTraceId, elapsedMs, latencyStart } from '@/lib/performance/server-latency'
import { downloadSelfHostObject } from '@/lib/storage/self-host-object-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const HASH_RE = /^[0-9a-f]{64}$/
const MEDIA_PREFIX = String(process.env.PUDDLE_OPEN_PHOTO_PREFIX || 'media/photos/by-sha256/')
  .replace(/^\/+|\/+$/g, '')

function canonicalStorageKey(hash) {
  return `${MEDIA_PREFIX}/${hash.slice(0, 2)}/${hash}.jpg`
}

function serverTiming(entries, totalMs) {
  return [...entries, { name: 'total', durationMs: totalMs }]
    .map(({ name, durationMs }) => `${name};dur=${Math.max(0, Number(durationMs) || 0)}`)
    .join(',')
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

    const downloadStartedAt = latencyStart()
    const body = await downloadSelfHostObject(canonicalStorageKey(hash), { maxBytes: 10_000_000, missingOk: true })
    if (body === null) {
      const missing = new Error('Photo not found.')
      missing.status = 404
      throw missing
    }
    timings.push({ name: 'object', durationMs: elapsedMs(downloadStartedAt) })
    const verifyStartedAt = latencyStart()
    const actualHash = createHash('sha256').update(body).digest('hex')
    if (actualHash !== hash) throw new Error('Canonical photo failed SHA-256 verification.')
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
