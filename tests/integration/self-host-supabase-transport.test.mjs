import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { authCookieOptions } from '../../lib/supabase/cookie-options.js'
import { privateSupabaseUrl, supabaseServerFetch } from '../../lib/supabase/server-transport.js'
import { validateStagingAuthSmokeEnv } from '../../scripts/self-host-staging-auth-smoke.mjs'

const publicUrl = 'https://api-staging.puddle.you'
const internalUrl = 'http://puddle-supabase-gateway:8000'

test('server transport rewrites only Supabase network requests while preserving paths and queries', () => {
  assert.equal(
    privateSupabaseUrl(`${publicUrl}/rest/v1/profiles?select=id`, publicUrl, internalUrl).toString(),
    `${internalUrl}/rest/v1/profiles?select=id`
  )
  assert.throws(() => privateSupabaseUrl('https://other.example/auth/v1/user', publicUrl, internalUrl), /another origin/)
  assert.throws(() => privateSupabaseUrl(`${publicUrl}/auth/v1/user`, publicUrl, ''), /SUPABASE_INTERNAL_URL/)
})

test('server transport preserves POST bodies and request headers', async () => {
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const originalInternalUrl = process.env.SUPABASE_INTERNAL_URL
  const originalFetch = globalThis.fetch
  let received
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = publicUrl
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test'
    process.env.SUPABASE_INTERNAL_URL = internalUrl
    globalThis.fetch = async (input, init) => {
      received = new Request(input, init)
      return new Response('{}', { status: 200 })
    }
    await supabaseServerFetch(new Request(`${publicUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"test@example.invalid"}'
    }))
    assert.equal(received.url, `${internalUrl}/auth/v1/token?grant_type=password`)
    assert.equal(received.method, 'POST')
    assert.equal(received.headers.get('content-type'), 'application/json')
    assert.equal(await received.text(), '{"email":"test@example.invalid"}')
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of [
      ['NEXT_PUBLIC_SUPABASE_URL', originalPublicUrl],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', originalKey],
      ['SUPABASE_INTERNAL_URL', originalInternalUrl]
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('Supabase SDK sends REST calls through the private gateway', async () => {
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const originalInternalUrl = process.env.SUPABASE_INTERNAL_URL
  const originalFetch = globalThis.fetch
  let requestedUrl
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = publicUrl
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test'
    process.env.SUPABASE_INTERNAL_URL = internalUrl
    globalThis.fetch = async (input) => {
      requestedUrl = new Request(input).url
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = createClient(publicUrl, 'publishable-test', {
      global: { fetch: supabaseServerFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    const result = await client.from('profiles').select('id').limit(1)
    assert.equal(result.error, null)
    assert.match(requestedUrl, /^http:\/\/puddle-supabase-gateway:8000\/rest\/v1\/profiles\?/)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of [
      ['NEXT_PUBLIC_SUPABASE_URL', originalPublicUrl],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', originalKey],
      ['SUPABASE_INTERNAL_URL', originalInternalUrl]
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('browser and server clients retain the same session key and externally usable media URLs', () => {
  const cookies = { getAll: () => [], setAll: () => {} }
  const browser = createBrowserClient(publicUrl, 'publishable-test', { cookieOptions: authCookieOptions(), cookies })
  const server = createServerClient(publicUrl, 'publishable-test', { cookieOptions: authCookieOptions(), cookies })
  assert.equal(browser.auth.storageKey, server.auth.storageKey)
  const media = createClient(publicUrl, 'publishable-test', {
    global: { fetch: supabaseServerFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  assert.equal(media.storage.from('puddle-public-media').getPublicUrl('avatars/example.png').data.publicUrl,
    `${publicUrl}/storage/v1/object/public/puddle-public-media/avatars/example.png`)
})

test('private transport is installed only in server-side client factories', async () => {
  const serverFiles = ['server.js', 'proxy.js', 'admin.js', 'public.js']
  for (const file of serverFiles) {
    const source = await readFile(new URL(`../../lib/supabase/${file}`, import.meta.url), 'utf8')
    assert.match(source, /global: \{ fetch: supabaseServerFetch \}/)
  }
  const browser = await readFile(new URL('../../lib/supabase/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(browser, /supabaseServerFetch|SUPABASE_INTERNAL_URL/)
})

test('disposable auth smoke refuses production hosts and requires an explicit staging gate', () => {
  const config = {
    PUDDLE_STAGING_CONFIRM: 'staging-only',
    PUDDLE_STAGING_APP_URL: 'http://127.0.0.1:3103',
    PUDDLE_STAGING_AUTH_URL: 'http://127.0.0.1:8000',
    PUDDLE_STAGING_SITE_URL: 'https://staging.example.com',
    PUDDLE_STAGING_SERVICE_KEY: 'staging-test-key'
  }
  assert.equal(validateStagingAuthSmokeEnv(config).site, 'https://staging.example.com')
  assert.throws(() => validateStagingAuthSmokeEnv({ ...config, PUDDLE_STAGING_CONFIRM: '' }), /staging-only/)
  assert.throws(() => validateStagingAuthSmokeEnv({ ...config, PUDDLE_STAGING_APP_URL: 'https://puddle.you' }), /loopback/)
  assert.throws(() => validateStagingAuthSmokeEnv({ ...config, PUDDLE_STAGING_SITE_URL: 'https://puddle.you' }), /staging origin/)
})

test('mail capture remains isolated to an opt-in staging overlay', async () => {
  const [staging, production, supabase] = await Promise.all([
    readFile(new URL('../../deploy/self-host/supabase-mailpit.staging.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/compose.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/supabase-compose.override.yaml', import.meta.url), 'utf8')
  ])
  assert.match(staging, /image: axllent\/mailpit:v\d+\.\d+\.\d+/)
  assert.match(staging, /127\.0\.0\.1:8025:8025/)
  assert.match(staging, /GOTRUE_SMTP_HOST: mailpit/)
  assert.doesNotMatch(production, /mailpit/)
  assert.doesNotMatch(supabase, /mailpit/)
})
