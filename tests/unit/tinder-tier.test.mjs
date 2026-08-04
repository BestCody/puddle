import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { membershipFromSubscription, membershipIsActive, verifyStripeWebhook } from '../../lib/billing/stripe.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const source = (path) => readFile(new URL(path, `file://${root}/`), 'utf8')

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

test('global connections require opt-in, adulthood, paid access, and a shared positive place action', async () => {
  const migration = await source('supabase/migrations/10036_tinder_tier_global_connections.sql')
  const hardening = await source('supabase/migrations/10037_tinder_tier_entitlement_hardening.sql')
  assert.match(migration, /discoverable boolean not null default false/)
  assert.match(migration, /profile\.birth_date<=current_date-interval '18 years'/)
  assert.match(migration, /action\.action in \('saved','interested'\)/)
  assert.match(migration, /theirs\.location_id=mine\.location_id/)
  assert.match(migration, /status text not null default 'pending'/)
  assert.match(migration, /thread\.status='accepted'/)
  assert.match(migration, /global_connection_blocks/)
  assert.match(migration, /global_connection_reports/)
  assert.match(hardening, /puddle_tinder_active_v1\(auth\.uid\(\)\)/)
  assert.match(hardening, /puddle_adult_v1\(auth\.uid\(\)\)/)
  assert.match(hardening, /return jsonb_build_object\('eligible',false,'threads','\[\]'::jsonb\)/)
})
