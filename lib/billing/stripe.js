import { createHmac, timingSafeEqual } from 'node:crypto'

const STRIPE_API = 'https://api.stripe.com/v1'
const ACTIVE_STATUSES = new Set(['active', 'trialing'])

function configuredValue(name) {
  return String(process.env[name] || '').trim()
}

export function stripeMembershipConfigured() {
  return Boolean(
    configuredValue('STRIPE_SECRET_KEY') &&
    configuredValue('STRIPE_WEBHOOK_SECRET') &&
    configuredValue('STRIPE_TINDER_PRICE_ID')
  )
}

function appendFormValue(params, key, value) {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(params, `${key}[${index}]`, item))
    return
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([child, item]) => appendFormValue(params, `${key}[${child}]`, item))
    return
  }
  params.append(key, String(value))
}

function stripeForm(values) {
  const params = new URLSearchParams()
  Object.entries(values || {}).forEach(([key, value]) => appendFormValue(params, key, value))
  return params
}

export async function stripeRequest(path, { method = 'POST', body = null } = {}) {
  const secret = configuredValue('STRIPE_SECRET_KEY')
  if (!secret) throw new Error('Payments are not configured.')
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    },
    body: body ? stripeForm(body) : undefined,
    cache: 'no-store'
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload?.error?.message || 'The payment provider could not complete that request.'))
    error.status = response.status
    error.code = payload?.error?.code || null
    throw error
  }
  return payload
}

export function createStripeCustomer({ email, userId }) {
  return stripeRequest('/customers', {
    body: {
      email,
      metadata: { puddle_user_id: userId }
    }
  })
}

export function createTinderCheckout({ customerId, userId, origin }) {
  return stripeRequest('/checkout/sessions', {
    body: {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: configuredValue('STRIPE_TINDER_PRICE_ID'), quantity: 1 }],
      subscription_data: { metadata: { puddle_user_id: userId, puddle_tier: 'tinder' } },
      success_url: `${origin}/membership?checkout=success`,
      cancel_url: `${origin}/membership?checkout=canceled`,
      allow_promotion_codes: true
    }
  })
}

export function createMembershipPortal({ customerId, origin }) {
  return stripeRequest('/billing_portal/sessions', {
    body: { customer: customerId, return_url: `${origin}/membership` }
  })
}

export function retrieveSubscription(subscriptionId) {
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' })
}

function signatureParts(header) {
  const parts = String(header || '').split(',').map((part) => part.trim())
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2)
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3))
  return { timestamp: Number(timestamp), signatures }
}

export function verifyStripeWebhook(rawBody, signatureHeader, secret = configuredValue('STRIPE_WEBHOOK_SECRET'), now = Date.now()) {
  if (!secret) return false
  const { timestamp, signatures } = signatureParts(signatureHeader)
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false
  if (Math.abs(Math.floor(now / 1000) - timestamp) > 300) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  return signatures.some((value) => {
    if (!/^[0-9a-f]{64}$/i.test(value)) return false
    const candidate = Buffer.from(value, 'hex')
    return candidate.length === expectedBytes.length && timingSafeEqual(candidate, expectedBytes)
  })
}

function unixDate(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}

function positiveQuantity(item) {
  if (item?.quantity === undefined || item?.quantity === null) return true
  return Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
}

export function membershipFromSubscription(
  subscription,
  userId = null,
  expectedPriceId = configuredValue('STRIPE_TINDER_PRICE_ID')
) {
  const status = String(subscription?.status || 'inactive')
  const metadataUserId = String(subscription?.metadata?.puddle_user_id || userId || '').trim() || null
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : []
  const matchingItem = expectedPriceId
    ? items.find((item) => item?.price?.id === expectedPriceId && positiveQuantity(item)) || null
    : null
  const storedItem = matchingItem || items[0] || null
  const priceId = storedItem?.price?.id || null
  const periodEnd = matchingItem?.current_period_end ?? subscription?.current_period_end ?? storedItem?.current_period_end
  const entitled = Boolean(expectedPriceId && matchingItem && ACTIVE_STATUSES.has(status))

  return {
    user_id: metadataUserId,
    tier: entitled ? 'tinder' : 'free',
    status,
    stripe_customer_id: typeof subscription?.customer === 'string' ? subscription.customer : subscription?.customer?.id || null,
    stripe_subscription_id: subscription?.id || null,
    stripe_price_id: priceId,
    current_period_end: unixDate(periodEnd),
    cancel_at_period_end: subscription?.cancel_at_period_end === true,
    updated_at: new Date().toISOString()
  }
}

export function membershipIsActive(membership, now = Date.now()) {
  if (!membership || membership.tier !== 'tinder' || !ACTIVE_STATUSES.has(membership.status)) return false
  if (!membership.current_period_end) return true
  return new Date(membership.current_period_end).getTime() > now
}
