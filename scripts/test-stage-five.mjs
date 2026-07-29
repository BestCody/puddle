import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { issueTicketToken, parseTicketToken, verifyTicketToken } from '../lib/tickets/signing.js'
import { parseStripeSignature, verifyStripeWebhook } from '../lib/stripe/client.js'
const{privateKey,publicKey}=generateKeyPairSync('ed25519')
process.env.TICKET_SIGNING_PRIVATE_KEY_BASE64=privateKey.export({format:'der',type:'pkcs8'}).toString('base64')
process.env.TICKET_SIGNING_PUBLIC_KEY_BASE64=publicKey.export({format:'der',type:'spki'}).toString('base64')
process.env.TICKET_TOKEN_ISSUER='puddle.you'
const ticket={id:'11111111-1111-4111-8111-111111111111',event_id:'22222222-2222-4222-8222-222222222222',order_id:'33333333-3333-4333-8333-333333333333',owner_id:'44444444-4444-4444-8444-444444444444',token_version:2,ticket_number:'PDL-ABC123'}
const issued=issueTicketToken(ticket),verified=verifyTicketToken(issued.token)
assert.equal(verified.tid,ticket.id);assert.equal(verified.eid,ticket.event_id);assert.equal(verified.ver,2);assert.equal(parseTicketToken(issued.token).payload.num,'PDL-ABC123')
const tokenParts=issued.token.split('.');tokenParts[3]=(tokenParts[3][0]==='A'?'B':'A')+tokenParts[3].slice(1);assert.throws(()=>verifyTicketToken(tokenParts.join('.')),/signature|format/i)
const secret='whsec_stage5_test',body=JSON.stringify({id:'evt_test',type:'checkout.session.completed'}),timestamp=1_800_000_000
const signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex'),header=`t=${timestamp},v1=${signature}`
assert.equal(parseStripeSignature(header).timestamp,timestamp);assert.equal(verifyStripeWebhook(body,header,secret,300,timestamp),true)
assert.throws(()=>verifyStripeWebhook(body+'x',header,secret,300,timestamp),/invalid/i);assert.throws(()=>verifyStripeWebhook(body,header,secret,300,timestamp+301),/time window/i)
console.log('Stage 5 ticket-signing and Stripe webhook tests passed.')
