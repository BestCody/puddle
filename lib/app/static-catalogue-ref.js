import { createHmac, timingSafeEqual } from 'node:crypto'

const VERSION = 1
const DEFAULT_TTL_SECONDS = 24 * 60 * 60

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64url(value) {
  return Buffer.from(String(value || ''), 'base64url')
}

function signingSecret(env = process.env) {
  const configured = String(
    env.STATIC_CATALOGUE_ACTION_SECRET ||
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim()
  if (configured) return configured
  if (env.NODE_ENV !== 'production') return 'puddle-static-catalogue-development-secret'
  return null
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signStaticCatalogueReference(place, manifest, {
  ttlSeconds = Number(process.env.STATIC_CATALOGUE_REF_TTL_SECONDS || DEFAULT_TTL_SECONDS),
  now = Date.now(),
  secret = signingSecret()
} = {}) {
  if (!secret) throw new Error('STATIC_CATALOGUE_ACTION_SECRET is required for static catalogue actions.')
  const tile = place?.tile
  const payload = {
    v: VERSION,
    id: String(place?.contentId || place?.id || ''),
    s: String(place?.source || ''),
    p: String(place?.sourcePlaceId || ''),
    r: String(manifest?.release || ''),
    z: Number(tile?.z),
    x: Number(tile?.x),
    y: Number(tile?.y),
    e: Math.floor(now / 1000) + Math.max(300, Math.min(7 * 24 * 60 * 60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS))
  }
  if (!payload.id || !payload.s || !payload.p || !payload.r || ![payload.z, payload.x, payload.y].every(Number.isInteger)) {
    throw new Error('Static catalogue reference is incomplete.')
  }
  const encoded = base64url(JSON.stringify(payload))
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifyStaticCatalogueReference(token, {
  expectedId = null,
  now = Date.now(),
  secret = signingSecret()
} = {}) {
  if (!secret) throw new Error('STATIC_CATALOGUE_ACTION_SECRET is required for static catalogue actions.')
  const [encoded, suppliedSignature, extra] = String(token || '').split('.')
  if (!encoded || !suppliedSignature || extra) throw new Error('Static catalogue reference is invalid.')
  const expectedSignature = signature(encoded, secret)
  const supplied = decodeBase64url(suppliedSignature)
  const expected = decodeBase64url(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('Static catalogue reference signature is invalid.')
  }
  let payload
  try {
    payload = JSON.parse(decodeBase64url(encoded).toString('utf8'))
  } catch {
    throw new Error('Static catalogue reference payload is invalid.')
  }
  if (
    Number(payload?.v) !== VERSION ||
    !payload?.id || !payload?.s || !payload?.p || !payload?.r ||
    ![payload?.z, payload?.x, payload?.y, payload?.e].every(Number.isInteger)
  ) throw new Error('Static catalogue reference payload is incomplete.')
  if (expectedId && payload.id !== String(expectedId)) throw new Error('Static catalogue reference does not match this place.')
  if (payload.e < Math.floor(now / 1000)) throw new Error('Static catalogue reference has expired.')
  return {
    version: VERSION,
    id: payload.id,
    source: payload.s,
    sourcePlaceId: payload.p,
    release: payload.r,
    tile: { z: payload.z, x: payload.x, y: payload.y },
    expiresAt: new Date(payload.e * 1000).toISOString()
  }
}
