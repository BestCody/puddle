import { createHmac, timingSafeEqual } from 'node:crypto'

const STRIPE_API = 'https://api.stripe.com/v1'

function configuredSecret() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!/^sk_(test|live)_/.test(key)) throw new Error('Stripe payments are not configured.')
  return key
}

function appendForm(params, key, value) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(params, `${key}[${index}]`, item))
    return
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([child, item]) => appendForm(params, `${key}[${child}]`, item))
    return
  }
  params.append(key, value === true ? 'true' : value === false ? 'false' : String(value))
}

export function stripeMode() {
  const key = String(process.env.STRIPE_SECRET_KEY || '')
  return key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unconfigured'
}

export async function stripeRequest(method, path, body = null, { idempotencyKey, stripeAccount } = {}) {
  const headers = {
    authorization: `Bearer ${configuredSecret()}`,
    'stripe-version': String(process.env.STRIPE_API_VERSION || '2026-02-25.clover')
  }
  if (idempotencyKey) headers['idempotency-key'] = String(idempotencyKey).slice(0, 255)
  if (stripeAccount) headers['stripe-account'] = stripeAccount
  let payload
  if (body) {
    const params = new URLSearchParams()
    Object.entries(body).forEach(([key, value]) => appendForm(params, key, value))
    payload = params.toString()
    headers['content-type'] = 'application/x-www-form-urlencoded'
  }
  const response = await fetch(`${STRIPE_API}${path}`, { method, headers, body: payload, cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(data?.error?.message || 'Stripe request failed.'))
    error.type = data?.error?.type
    error.code = data?.error?.code
    error.status = response.status
    throw error
  }
  return data
}

export function createConnectedAccount({ email, profileId, country }) {
  return stripeRequest('POST', '/accounts', {
    type: 'express',
    country: country || process.env.STRIPE_CONNECT_COUNTRY || 'CA',
    email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_type: 'individual',
    metadata: { puddle_profile_id: profileId }
  }, { idempotencyKey: `connect-account-${profileId}` })
}

export function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  return stripeRequest('POST', '/account_links', {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  })
}

export function retrieveAccount(accountId) {
  return stripeRequest('GET', `/accounts/${encodeURIComponent(accountId)}`)
}

export function createCheckoutSession({ order, lineItems, destinationAccount, successUrl, cancelUrl, expiresAt }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: order.id,
    customer_email: order.buyer_email || undefined,
    line_items: lineItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: String(order.currency || 'CAD').toLowerCase(),
        unit_amount: item.unit_amount_cents,
        product_data: { name: item.name, description: item.description || undefined, metadata: { ticket_type_id: item.ticket_type_id } },
        tax_behavior: 'exclusive'
      }
    })),
    metadata: { puddle_order_id: order.id, puddle_event_id: order.event_id, puddle_buyer_id: order.buyer_id },
    payment_intent_data: {
      application_fee_amount: order.platform_fee_cents || undefined,
      transfer_data: { destination: destinationAccount },
      metadata: { puddle_order_id: order.id, puddle_event_id: order.event_id, puddle_buyer_id: order.buyer_id }
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: expiresAt,
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    allow_promotion_codes: false,
    locale: 'auto'
  }, { idempotencyKey: `checkout-${order.id}` })
}

export function expireCheckoutSession(sessionId) {
  return stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {})
}

export function retrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`)
}

export function retrievePaymentIntent(paymentIntentId) {
  return stripeRequest('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`)
}

export function createStripeRefund({ chargeId, amount, reason, idempotencyKey }) {
  return stripeRequest('POST', '/refunds', {
    charge: chargeId,
    amount,
    reason: reason || 'requested_by_customer',
    reverse_transfer: true,
    refund_application_fee: true,
    metadata: { puddle_refund_request_id: idempotencyKey }
  }, { idempotencyKey: `refund-${idempotencyKey}` })
}

export function parseStripeSignature(header) {
  const values = String(header || '').split(',').map((part) => part.trim()).filter(Boolean)
  const parsed = { signatures: [] }
  for (const value of values) {
    const [key, item] = value.split('=', 2)
    if (key === 't') parsed.timestamp = Number(item)
    if (key === 'v1') parsed.signatures.push(item)
  }
  return parsed
}

export function verifyStripeWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('Stripe webhook verification is not configured.')
  const parsed = parseStripeSignature(header)
  if (!Number.isFinite(parsed.timestamp) || !parsed.signatures.length) throw new Error('Stripe webhook signature is malformed.')
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) throw new Error('Stripe webhook signature is outside the allowed time window.')
  const expected = createHmac('sha256', secret).update(`${parsed.timestamp}.${rawBody}`).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  const valid = parsed.signatures.some((signature) => {
    try {
      const candidate = Buffer.from(signature, 'hex')
      return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer)
    } catch { return false }
  })
  if (!valid) throw new Error('Stripe webhook signature is invalid.')
  return true
}
