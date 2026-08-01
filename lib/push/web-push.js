import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto'

function decodeBase64Url(value) {
  const normalized = String(value || '').replaceAll('-', '+').replaceAll('_', '/')
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64')
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function hkdfExtract(salt, ikm) {
  return createHmac('sha256', salt).update(ikm).digest()
}

function hkdfExpand(prk, info, length) {
  const chunks = []
  let previous = Buffer.alloc(0)
  let total = 0
  let counter = 1
  while (total < length) {
    previous = createHmac('sha256', prk).update(Buffer.concat([previous, info, Buffer.from([counter])])).digest()
    chunks.push(previous)
    total += previous.length
    counter += 1
  }
  return Buffer.concat(chunks).subarray(0, length)
}

function vapidConfig() {
  const publicKey = decodeBase64Url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  const privateKey = decodeBase64Url(process.env.VAPID_PRIVATE_KEY)
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.')
  if (privateKey.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be a 32-byte P-256 private key.')
  return { publicKey, privateKey, subject: String(process.env.VAPID_SUBJECT || 'mailto:admin@puddle.you').slice(0, 240) }
}

function vapidAuthorization(endpoint, config) {
  const header = encodeBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = encodeBase64Url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: config.subject }))
  const signingInput = `${header}.${payload}`
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: encodeBase64Url(config.publicKey.subarray(1, 33)), y: encodeBase64Url(config.publicKey.subarray(33, 65)), d: encodeBase64Url(config.privateKey) }, format: 'jwk' })
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${signingInput}.${encodeBase64Url(signature)}, k=${encodeBase64Url(config.publicKey)}`
}

function encryptPayload(subscription, payload) {
  const clientPublic = decodeBase64Url(subscription.p256dh)
  const authSecret = decodeBase64Url(subscription.auth)
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error('Push subscription public key is invalid.')
  if (authSecret.length < 16) throw new Error('Push subscription authentication secret is invalid.')

  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const serverPublic = ecdh.getPublicKey(null, 'uncompressed')
  const sharedSecret = ecdh.computeSecret(clientPublic)
  const authPrk = hkdfExtract(authSecret, sharedSecret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic])
  const ikm = hkdfExpand(authPrk, keyInfo, 32)
  const salt = randomBytes(16)
  const contentPrk = hkdfExtract(salt, ikm)
  const contentKey = hkdfExpand(contentPrk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfExpand(contentPrk, Buffer.from('Content-Encoding: nonce\0'), 12)
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])])
  if (plaintext.length > 3900) throw new Error('Push payload is too large.')
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096, 0)
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, encrypted])
}

export function webPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export async function sendWebPush(subscription, payload, { ttl = 86400, timeoutMs = 12_000 } = {}) {
  const endpoint = new URL(subscription.endpoint)
  if (endpoint.protocol !== 'https:') throw new Error('Push endpoint must use HTTPS.')
  const config = vapidConfig()
  const body = encryptPayload(subscription, payload)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidAuthorization(endpoint.toString(), config),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(Math.min(2_419_200, Math.max(0, Number(ttl) || 0))),
      urgency: 'normal'
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error'
  })
  return { ok: response.ok, status: response.status, expired: response.status === 404 || response.status === 410, retryable: response.status === 429 || response.status >= 500 }
}
