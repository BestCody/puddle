import { createHmac, randomUUID } from 'node:crypto'

const UNSAFE = new Set(['POST','PUT','PATCH','DELETE'])

export function requestId(headers) {
  return String(headers.get?.('x-request-id') || headers.get?.('cf-ray') || randomUUID()).slice(0, 120)
}

export function requestIp(headers) {
  const forwarded = String(headers.get?.('x-forwarded-for') || '').split(',')[0].trim()
  return String(headers.get?.('cf-connecting-ip') || forwarded || headers.get?.('x-real-ip') || 'unknown').slice(0, 120)
}

export function hashSecuritySignal(value) {
  const secret = String(process.env.SECURITY_HASH_SECRET || process.env.SUPABASE_SECRET_KEY || 'puddle-development-security-hash')
  return createHmac('sha256', secret).update(String(value || 'unknown')).digest('hex')
}

export function deviceSignal(headers) {
  return String(headers.get?.('x-puddle-device') || headers.get?.('user-agent') || 'unknown').slice(0, 500)
}

export function requestContext(headers) {
  const ip = requestIp(headers)
  return {
    requestId: requestId(headers),
    ip,
    ipHash: hashSecuritySignal(ip),
    deviceHash: hashSecuritySignal(deviceSignal(headers)),
    userAgentHash: hashSecuritySignal(String(headers.get?.('user-agent') || 'unknown'))
  }
}

export function isUnsafeMethod(method) { return UNSAFE.has(String(method || '').toUpperCase()) }

export function enforceRequestSize(request, maxBytes) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length && length > maxBytes) {
    const error = new Error('Request payload is too large.')
    error.status = 413
    throw error
  }
}

export async function readJsonLimited(request, maxBytes = 64_000) {
  enforceRequestSize(request, maxBytes)
  const raw = await request.text()
  if (Buffer.byteLength(raw) > maxBytes) {
    const error = new Error('Request payload is too large.')
    error.status = 413
    throw error
  }
  try { return raw ? JSON.parse(raw) : {} } catch {
    const error = new Error('Request body is invalid.')
    error.status = 400
    throw error
  }
}

export function safeSecurityError(error, fallback = 'That request could not be completed.') {
  const message = String(error?.message || '').slice(0, 240)
  if (!message || /schema|relation|column|constraint|policy|service role|secret|token|stack/i.test(message)) return fallback
  return message
}
