import { normalizeClientTelemetry } from '@/lib/performance/client-telemetry'
import { applicationOrigin } from '@/lib/security/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const responseHeaders = { 'Cache-Control': 'no-store' }
const MAX_BODY_BYTES = 2_048
let windowStartedAt = 0
let acceptedInWindow = 0

export async function POST(request) {
  if (request.headers.get('origin') !== applicationOrigin(request)) return new Response(null, { status: 403, headers: responseHeaders })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415, headers: responseHeaders })
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: responseHeaders })

  const raw = await request.text().catch(() => '')
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: responseHeaders })
  let parsed
  try { parsed = JSON.parse(raw) } catch { return new Response(null, { status: 400, headers: responseHeaders }) }
  const event = normalizeClientTelemetry(parsed)
  if (!event) return new Response(null, { status: 400, headers: responseHeaders })

  const now = Date.now()
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now
    acceptedInWindow = 0
  }
  // This per-process cap limits log amplification on a single-host deployment.
  if (acceptedInWindow++ < 1_200) console.info('[puddle_rum]', JSON.stringify(event))
  return new Response(null, { status: 204, headers: responseHeaders })
}
