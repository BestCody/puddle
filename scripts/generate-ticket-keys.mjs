import { generateKeyPairSync } from 'node:crypto'
const {privateKey,publicKey}=generateKeyPairSync('ed25519')
const privateDer=privateKey.export({format:'der',type:'pkcs8'}).toString('base64')
const publicDer=publicKey.export({format:'der',type:'spki'}).toString('base64')
console.log(`TICKET_SIGNING_PRIVATE_KEY_BASE64=${privateDer}`)
console.log(`TICKET_SIGNING_PUBLIC_KEY_BASE64=${publicDer}`)
console.log('Store the private key only in protected server environment variables. The public key may be supplied to check-in devices.')
