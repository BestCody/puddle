import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const privateJwk = privateKey.export({ format: 'jwk' })
const publicJwk = publicKey.export({ format: 'jwk' })

function decode(value) {
  return Buffer.from(String(value).replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - String(value).length % 4) % 4), 'base64')
}

const rawPublic = Buffer.concat([Buffer.from([4]), decode(publicJwk.x), decode(publicJwk.y)]).toString('base64url')
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${rawPublic}`)
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`)
console.log('VAPID_SUBJECT=mailto:admin@puddle.you')
