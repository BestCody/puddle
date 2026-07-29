import { createPrivateKey, createPublicKey, createHash, sign, verify } from 'node:crypto'

const PREFIX = 'puddle-ticket.v1'

function b64url(value) {
  return Buffer.from(value).toString('base64url')
}

function decode(value) {
  return Buffer.from(value, 'base64url')
}

function privateKey() {
  const value = String(process.env.TICKET_SIGNING_PRIVATE_KEY_BASE64 || '').trim()
  if (!value) throw new Error('Ticket signing is not configured.')
  return createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
}

function publicKey() {
  const value = String(process.env.TICKET_SIGNING_PUBLIC_KEY_BASE64 || '').trim()
  if (!value) throw new Error('Ticket verification is not configured.')
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' })
}

export function ticketTokenPayload(ticket, issuedAt = Math.floor(Date.now() / 1000)) {
  return {
    iss: String(process.env.TICKET_TOKEN_ISSUER || 'puddle.you'),
    aud: 'puddle-checkin',
    tid: ticket.id,
    eid: ticket.event_id,
    oid: ticket.order_id,
    own: ticket.owner_id,
    ver: Number(ticket.token_version || 1),
    num: ticket.ticket_number,
    iat: issuedAt
  }
}

export function issueTicketToken(ticket) {
  const encoded = b64url(JSON.stringify(ticketTokenPayload(ticket)))
  const signingInput = `${PREFIX}.${encoded}`
  const signature = sign(null, Buffer.from(signingInput), privateKey()).toString('base64url')
  const token = `${signingInput}.${signature}`
  return { token, hash: createHash('sha256').update(token).digest('hex') }
}

export function parseTicketToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== PREFIX) throw new Error('Ticket token format is invalid.')
  const payload = JSON.parse(decode(parts[2]).toString('utf8'))
  return { payload, signingInput: `${PREFIX}.${parts[2]}`, signature: decode(parts[3]) }
}

export function verifyTicketToken(token) {
  const parsed = parseTicketToken(token)
  const valid = verify(null, Buffer.from(parsed.signingInput), publicKey(), parsed.signature)
  if (!valid) throw new Error('Ticket signature is invalid.')
  if (parsed.payload.iss !== String(process.env.TICKET_TOKEN_ISSUER || 'puddle.you') || parsed.payload.aud !== 'puddle-checkin') throw new Error('Ticket token issuer is invalid.')
  return parsed.payload
}

export function ticketTokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}
