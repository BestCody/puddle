import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stagingAuthUrlValues, updateStagingAuthEnv } from '../../scripts/self-host-configure-staging-urls.mjs'

test('staging auth URLs stay on public HTTPS names and explicit callback paths', () => {
  const values = stagingAuthUrlValues('https://staging.puddle.you', 'https://api-staging.puddle.you')
  assert.deepEqual(values, {
    SITE_URL: 'https://staging.puddle.you',
    API_EXTERNAL_URL: 'https://api-staging.puddle.you/auth/v1',
    SUPABASE_PUBLIC_URL: 'https://api-staging.puddle.you',
    ADDITIONAL_REDIRECT_URLS: [
      'https://staging.puddle.you/auth/callback',
      'https://staging.puddle.you/auth/confirm',
      'https://staging.puddle.you/update-password'
    ].join(',')
  })
  const original = 'SECRET=keep-private\nSITE_URL=http://localhost:3000\nAPI_EXTERNAL_URL=http://localhost:8000/auth/v1\nSUPABASE_PUBLIC_URL=http://localhost:8000\nADDITIONAL_REDIRECT_URLS=\n'
  const updated = updateStagingAuthEnv(original, values)
  assert.ok(updated.includes('SECRET=keep-private'))
  assert.ok(!updated.includes('localhost'))
  assert.equal(updateStagingAuthEnv(updated, values), updated)
})

test('staging auth URL configuration rejects non-staging or duplicate entries', () => {
  assert.throws(() => stagingAuthUrlValues('https://puddle.you', 'https://api-staging.puddle.you'), /staging/)
  assert.throws(() => stagingAuthUrlValues('https://staging.puddle.you', 'https://staging.puddle.you'), /distinct/)
  assert.throws(() => updateStagingAuthEnv('SITE_URL=a\nSITE_URL=b\n', { SITE_URL: 'c' }), /exactly one/)
})
