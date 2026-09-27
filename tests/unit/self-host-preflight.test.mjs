import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSelfHostEnv } from '../../scripts/self-host-preflight.mjs'

const valid = {
  PUDDLE_DOMAIN: 'staging.example.com',
  SUPABASE_DOMAIN: 'database.example.com',
  ACME_EMAIL: 'operator@example.com',
  NEXT_PUBLIC_SITE_URL: 'https://staging.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://database.example.com',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
  SUPABASE_SECRET_KEY: 'server-secret-test',
  PUDDLE_OBJECT_STORE: 's3',
  PUDDLE_OBJECT_DATA_DIR: process.platform === 'win32' ? 'C:\\puddle\\objects' : '/srv/puddle/objects',
  OBJECT_STORAGE_ENDPOINT: 'http://objects:8333',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'puddle-assets',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'local-id',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
  CRON_SECRET: 'worker-secret',
  SECURITY_HASH_SECRET: 'a'.repeat(32),
  STRIPE_SECRET_KEY: 'stripe-secret',
  STRIPE_WEBHOOK_SECRET: 'webhook-secret',
  STRIPE_TINDER_PRICE_ID: 'price-test',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-test',
  TURNSTILE_SECRET_KEY: 'turnstile-secret'
}

test('self-host preflight accepts complete application configuration', () => {
  assert.deepEqual(validateSelfHostEnv(valid), [])
})

test('self-host preflight rejects missing secrets and mismatched hostnames without printing values', () => {
  const problems = validateSelfHostEnv({
    ...valid,
    PUDDLE_DOMAIN: 'example.com',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: '',
    SECURITY_HASH_SECRET: 'short',
    TURNSTILE_SECRET_KEY: ''
  })
  assert.ok(problems.some((problem) => problem.includes('OBJECT_STORAGE_SECRET_ACCESS_KEY')))
  assert.ok(problems.some((problem) => problem.includes('NEXT_PUBLIC_SITE_URL')))
  assert.ok(problems.some((problem) => problem.includes('SECURITY_HASH_SECRET')))
  assert.ok(problems.some((problem) => problem.includes('TURNSTILE_SECRET_KEY')))
  assert.ok(problems.every((problem) => !problem.includes('server-secret-test')))
})

test('self-host preflight requires a separate Supabase hostname matching its public URL', () => {
  const problems = validateSelfHostEnv({
    ...valid,
    SUPABASE_DOMAIN: valid.PUDDLE_DOMAIN
  })
  assert.ok(problems.some((problem) => problem.includes('distinct hostnames')))
  assert.ok(problems.some((problem) => problem.includes('NEXT_PUBLIC_SUPABASE_URL')))
})
