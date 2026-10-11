import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalPuddleAuthUrl, normalizeOrigin, requestOrigin, siteUrl } from '../../lib/auth/origin.js'

test('auth origins normalize HTTP URLs and reject executable schemes', () => {
  assert.equal(normalizeOrigin('https://www.puddle.you/path'), 'https://www.puddle.you')
  assert.equal(normalizeOrigin('javascript:alert(1)'), null)
})

test('request origins preserve the matching public host and reject a spoofed origin', () => {
  for (const host of ['puddle.you', 'www.puddle.you']) {
    const headers = new Headers({ origin: `https://${host}`, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' })
    assert.equal(requestOrigin(headers, 'https://puddle.you'), `https://${host}`)
  }
  const spoofed = new Headers({ origin: 'https://attacker.example', host: 'puddle.you', 'x-forwarded-host': 'puddle.you', 'x-forwarded-proto': 'https' })
  assert.equal(requestOrigin(spoofed, 'https://puddle.you'), 'https://puddle.you')
  assert.equal(requestOrigin(new Headers({ host: 'localhost:3000' }), 'https://puddle.you'), 'http://localhost:3000')
})

test('auth links use the configured public origin and reject remote paths', () => {
  const prior = process.env.NEXT_PUBLIC_SITE_URL
  process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.puddle.you'
  try {
    const headers = new Headers({ host: 'www.puddle.you', origin: 'https://www.puddle.you' })
    assert.equal(siteUrl(headers, '/auth/callback?next=/onboarding').toString(), 'https://staging.puddle.you/auth/callback?next=/onboarding')
    assert.equal(siteUrl(new Headers({ host: '0.0.0.0:3000' }), '/landing.html').toString(), 'https://staging.puddle.you/landing.html')
    for (const path of ['//attacker.example/path', '/\\attacker.example/path']) assert.throws(() => siteUrl(headers, path), /local path/)
  } finally {
    if (prior === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = prior
  }
})

test('canonical auth redirects preserve the callback query without redirecting unrelated hosts or routes', () => {
  const paths = new Set(['/signup', '/auth/callback', '/auth/confirm'])
  for (const path of ['/signup?email=ava%40example.com', '/auth/callback?code=abc&next=/onboarding']) {
    assert.equal(canonicalPuddleAuthUrl(`https://www.puddle.you${path}`, 'https://puddle.you', paths)?.toString(), `https://puddle.you${path}`)
  }
  for (const url of ['https://puddle.you/signup', 'https://preview.example.com/signup', 'https://www.puddle.you/privacy']) {
    assert.equal(canonicalPuddleAuthUrl(url, 'https://puddle.you', paths), null)
  }
})
