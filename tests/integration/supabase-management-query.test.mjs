import assert from 'node:assert/strict'
import test from 'node:test'
import { createManagementQuery, projectRefFromUrl } from '../../scripts/supabase-management-query.mjs'

test('management backfill accepts only a hosted Supabase project URL', () => {
  assert.equal(projectRefFromUrl('https://cegoqtvajwajczbofpep.supabase.co'), 'cegoqtvajwajczbofpep')
  assert.throws(() => projectRefFromUrl('https://example.com'), /hosted Supabase project URL/)
})

test('management query sends parameterized SQL and checks response shape', async () => {
  const calls = []
  const query = createManagementQuery({
    projectUrl: 'https://cegoqtvajwajczbofpep.supabase.co',
    accessToken: 'test-token',
    fetchFn: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => [{ remaining: 0 }] }
    }
  })
  assert.deepEqual(await query('select $1::integer as remaining', [0]), [{ remaining: 0 }])
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/cegoqtvajwajczbofpep/database/query')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    query: 'select $1::integer as remaining', parameters: [0]
  })
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token')
})

test('management query fails closed on restrictions and malformed responses', async () => {
  const options = { projectUrl: 'https://cegoqtvajwajczbofpep.supabase.co', accessToken: 'test-token' }
  const restricted = createManagementQuery({
    ...options,
    fetchFn: async () => ({ ok: false, status: 402, json: async () => ({ message: 'restricted' }) })
  })
  await assert.rejects(restricted('select 1'), /failed \(402\): restricted/)
  const malformed = createManagementQuery({
    ...options,
    fetchFn: async () => ({ ok: true, json: async () => ({ result: 'unexpected' }) })
  })
  await assert.rejects(malformed('select 1'), /unexpected result/)
})
