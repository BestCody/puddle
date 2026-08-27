import assert from 'node:assert/strict'
import test from 'node:test'
import { cspValue } from '../../lib/security/headers.js'

test('CSP permits only the Supabase websocket origin matching the configured transport', () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    const hosted = cspValue({ nonce: 'test' })
    assert.match(hosted, /connect-src[^;]*https:\/\/project\.supabase\.co[^;]*wss:\/\/project\.supabase\.co/)

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321'
    const local = cspValue({ nonce: 'test' })
    assert.match(local, /connect-src[^;]*http:\/\/127\.0\.0\.1:55321[^;]*ws:\/\/127\.0\.0\.1:55321/)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original
  }
})
