import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { membershipFromSubscription, membershipIsActive, verifyStripeWebhook } from '../../lib/billing/stripe.js'

test('Stripe webhook verification accepts only a current matching signature', () => {
  const raw = JSON.stringify({ id: 'evt_test', type: 'customer.subscription.updated' })
  const secret = 'whsec_test_value'
  const timestamp = 1_800_000_000
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')
  const header = `t=${timestamp},v1=${digest}`
  assert.equal(verifyStripeWebhook(raw, header, secret, timestamp * 1000), true)
  assert.equal(verifyStripeWebhook(`${raw} `, header, secret, timestamp * 1000), false)
  assert.equal(verifyStripeWebhook(raw, header, secret, (timestamp + 301) * 1000), false)
})

test('active subscriptions map to Tinder tier and expired access closes', () => {
  const subscription = {
    id: 'sub_test',
    customer: 'cus_test',
    status: 'active',
    current_period_end: 2_000_000_000,
    cancel_at_period_end: false,
    metadata: { puddle_user_id: '00000000-0000-4000-8000-000000000001' },
    items: { data: [{ price: { id: 'price_test' } }] }
  }
  const membership = membershipFromSubscription(subscription)
  assert.equal(membership.tier, 'tinder')
  assert.equal(membership.stripe_price_id, 'price_test')
  assert.equal(membershipIsActive(membership, 1_900_000_000_000), true)
  assert.equal(membershipIsActive(membership, 2_100_000_000_000), false)
})

test('canceled subscriptions lose the paid entitlement', () => {
  const membership = membershipFromSubscription({ id: 'sub_canceled', customer: 'cus_test', status: 'canceled' }, '00000000-0000-4000-8000-000000000001')
  assert.equal(membership.tier, 'free')
  assert.equal(membershipIsActive(membership), false)
})
