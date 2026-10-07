import assert from 'node:assert/strict'
import test from 'node:test'
import { connectSelfHostPostgres, validateSelfHostDatabaseUrl } from '../../scripts/self-host-postgres-query.mjs'

test('backfill accepts only a loopback self-hosted Postgres URL', () => {
  assert.match(validateSelfHostDatabaseUrl('postgresql://operator:secret@127.0.0.1:5432/postgres'), /^postgresql:/)
  for (const url of ['https://project.supabase.co', 'postgresql://operator:secret@db.example.com/postgres', 'postgresql://operator@localhost/postgres?sslmode=disable']) {
    assert.throws(() => validateSelfHostDatabaseUrl(url))
  }
})

test('backfill sends parameterized SQL through one direct connection and closes it', async () => {
  const calls = []
  class Client {
    constructor(options) { calls.push(options) }
    async connect() { calls.push('connect') }
    async query(query, parameters) { calls.push({ query, parameters }); return { rows: [{ remaining: 0 }] } }
    async end() { calls.push('end') }
  }
  const db = await connectSelfHostPostgres({ connectionString: 'postgresql://operator:secret@localhost/postgres', ClientType: Client })
  assert.deepEqual(await db.querySql('select $1::integer as remaining', [0]), [{ remaining: 0 }])
  await db.close()
  assert.equal(calls[0].ssl, false)
  assert.deepEqual(calls.slice(1), ['connect', { query: 'select $1::integer as remaining', parameters: [0] }, 'end'])
})
