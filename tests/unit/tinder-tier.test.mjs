import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { membershipFromSubscription, membershipIsActive, verifyStripeWebhook } from '../../lib/billing/stripe.js'

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

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

test('membership page displays Tinder tier at $10 per month without the removed billing disclosure', async () => {
  const page = await source('app/(product)/membership/page.js')
  assert.match(page, /TINDER_TIER_MONTHLY_PRICE = '\$10\/month'/)
  assert.doesNotMatch(page, /Billed monthly\. Taxes and renewal terms appear before payment\./)
  assert.doesNotMatch(page, /<h2>Monthly<\/h2>/)
})

test('subscription webhooks refresh the current Stripe object before changing access', async () => {
  const route = await source('app/api/billing/webhook/route.js')
  assert.match(route, /event\.type\.startsWith\('customer\.subscription\.'\)/)
  assert.match(route, /const subscription = await currentSubscription\(object\)/)
  assert.match(route, /return retrieveSubscription\(id\)/)
  assert.doesNotMatch(route, /await syncSubscription\(admin, object\)/)
})

test('Stripe billing uses the canonical endpoint and retries marked events that cannot be linked', async () => {
  const route = await source('app/api/billing/webhook/route.js')
  await assert.rejects(source('app/api/stripe/webhook/route.js'), { code: 'ENOENT' })
  assert.doesNotMatch(route, /api\/stripe\/webhook/)
  assert.match(route, /invoice\.paid/)
  assert.match(route, /invoice\.payment_failed/)
  assert.match(route, /Stripe subscription is not linked to a Puddle user\./)
})

test('the configured active Stripe price maps to Tinder tier and item period expiry closes access', () => {
  const subscription = {
    id: 'sub_test',
    customer: 'cus_test',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { puddle_user_id: '00000000-0000-4000-8000-000000000001' },
    items: { data: [{ price: { id: 'price_test' }, quantity: 1, current_period_end: 2_000_000_000 }] }
  }
  const membership = membershipFromSubscription(subscription, null, 'price_test')
  assert.equal(membership.tier, 'tinder')
  assert.equal(membership.stripe_price_id, 'price_test')
  assert.equal(membership.current_period_end, new Date(2_000_000_000 * 1000).toISOString())
  assert.equal(membership.cancel_at_period_end, false)
  assert.equal(membershipIsActive(membership, 1_900_000_000_000), true)
  assert.equal(membershipIsActive(membership, 2_100_000_000_000), false)
})

test('scheduled Stripe cancellations are visible before the paid period ends', () => {
  const membership = membershipFromSubscription({
    id: 'sub_scheduled_cancel',
    customer: 'cus_test',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: 2_000_000_100,
    items: { data: [{ price: { id: 'price_test' }, quantity: 1, current_period_end: 2_000_000_000 }] }
  }, '00000000-0000-4000-8000-000000000001', 'price_test', 2_000_000_000_000)
  assert.equal(membership.cancel_at_period_end, true)
  assert.equal(membership.tier, 'tinder')
  assert.equal(membershipIsActive(membership, 1_900_000_000_000), true)

  const ended = membershipFromSubscription({
    id: 'sub_ended_cancel',
    customer: 'cus_test',
    status: 'canceled',
    cancel_at_period_end: false,
    cancel_at: 1_900_000_000,
    items: { data: [{ price: { id: 'price_test' }, quantity: 1, current_period_end: 2_000_000_000 }] }
  }, '00000000-0000-4000-8000-000000000001', 'price_test', 2_000_000_000_000)
  assert.equal(ended.cancel_at_period_end, false)
  assert.equal(ended.tier, 'free')
})

test('another price or a zero-quantity Tinder item does not grant Tinder tier', () => {
  const otherPrice = membershipFromSubscription({
    id: 'sub_other',
    customer: 'cus_test',
    status: 'active',
    items: { data: [{ price: { id: 'price_other' }, quantity: 1, current_period_end: 2_000_000_000 }] }
  }, '00000000-0000-4000-8000-000000000001', 'price_tinder')
  assert.equal(otherPrice.tier, 'free')
  assert.equal(otherPrice.stripe_price_id, 'price_other')
  assert.equal(membershipIsActive(otherPrice), false)

  const zeroQuantity = membershipFromSubscription({
    id: 'sub_zero',
    customer: 'cus_test',
    status: 'active',
    items: { data: [{ price: { id: 'price_tinder' }, quantity: 0, current_period_end: 2_000_000_000 }] }
  }, '00000000-0000-4000-8000-000000000001', 'price_tinder')
  assert.equal(zeroQuantity.tier, 'free')
  assert.equal(membershipIsActive(zeroQuantity), false)
})

test('canceled subscriptions lose the paid entitlement', () => {
  const membership = membershipFromSubscription({
    id: 'sub_canceled',
    customer: 'cus_test',
    status: 'canceled',
    items: { data: [{ price: { id: 'price_test' }, quantity: 1 }] }
  }, '00000000-0000-4000-8000-000000000001', 'price_test')
  assert.equal(membership.tier, 'free')
  assert.equal(membershipIsActive(membership), false)
})
