import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('membership upgrade goes directly from the Pass card to Stripe checkout', async () => {
  const membership = await read('app/(product)/membership/page.js')

  assert.match(membership, /startTinderCheckout/)
  assert.match(membership, /form action=\{startTinderCheckout\}/)
  assert.doesNotMatch(membership, /href="\/membership\/checkout"/)
  assert.match(membership, />Upgrade<\/button>/)
})

test('legacy Puddle checkout never collects raw payment credentials', async () => {
  const checkout = await read('app/(product)/membership/checkout/page.js')

  assert.doesNotMatch(checkout, /Card number/i)
  assert.doesNotMatch(checkout, /\bCVC\b/i)
  assert.doesNotMatch(checkout, /name=["']card/i)
  assert.doesNotMatch(checkout, /stripeRequest\(/)
  assert.match(checkout, /Stripe will show the payment methods available/)
})

test('checkout preserves entitlement and environment guards before payment', async () => {
  const checkout = await read('app/(product)/membership/checkout/page.js')

  assert.match(checkout, /if \(snapshot\.active\) redirect\('\/global-matches'\)/)
  assert.match(checkout, /if \(!snapshot\.adult\)/)
  assert.match(checkout, /if \(!snapshot\.paymentsConfigured\)/)
})
