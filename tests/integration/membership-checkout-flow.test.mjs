import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('membership upgrade opens the branded Puddle checkout before Stripe', async () => {
  const membership = await read('app/membership/page.js')
  const checkout = await read('app/membership/checkout/page.js')

  assert.match(membership, /href="\/membership\/checkout"/)
  assert.doesNotMatch(membership, /form action=\{startTinderCheckout\}/)
  assert.match(checkout, /form action=\{startTinderCheckout\}/)
  assert.match(checkout, /Continue to secure payment/)
  assert.match(checkout, /MONTHLY_PRICE = '\$10\.00'/)
  assert.match(checkout, /Promotion codes supported/)
})

test('Puddle checkout never collects raw payment credentials', async () => {
  const checkout = await read('app/membership/checkout/page.js')

  assert.doesNotMatch(checkout, /Card number/i)
  assert.doesNotMatch(checkout, /\bCVC\b/i)
  assert.doesNotMatch(checkout, /name=["']card/i)
  assert.doesNotMatch(checkout, /stripeRequest\(/)
  assert.match(checkout, /Stripe will show the payment methods available/)
})

test('checkout preserves entitlement and environment guards before payment', async () => {
  const checkout = await read('app/membership/checkout/page.js')

  assert.match(checkout, /if \(snapshot\.active\) redirect\('\/global-matches'\)/)
  assert.match(checkout, /if \(!snapshot\.adult\)/)
  assert.match(checkout, /if \(!snapshot\.paymentsConfigured\)/)
})
