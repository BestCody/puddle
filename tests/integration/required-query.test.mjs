import assert from 'node:assert/strict'
import test from 'node:test'
import { requiredQuery } from '../../lib/app/required-query.js'
import { getAdminDashboard, getModerationCases } from '../../lib/app/admin-data.js'

test('required database reads preserve empty results but propagate failures', async () => {
  const databaseError = new Error('database unavailable')
  assert.deepEqual(await requiredQuery(Promise.resolve({ data: [], error: null })), [])
  assert.equal(await requiredQuery(Promise.resolve({ data: null, error: null })), null)
  await assert.rejects(requiredQuery(Promise.resolve({ data: null, error: databaseError })), databaseError)
  await assert.rejects(requiredQuery(Promise.reject(databaseError)), databaseError)
})

test('admin reads surface database failures instead of presenting an empty safety queue', async () => {
  const databaseError = new Error('moderation database unavailable')
  const supabase = {
    rpc: () => Promise.resolve({ data: null, error: databaseError }),
    from: () => ({
      select() { return this },
      order() { return this },
      limit() { return Promise.resolve({ data: null, error: databaseError }) }
    })
  }
  await assert.rejects(getAdminDashboard(supabase), databaseError)
  await assert.rejects(getModerationCases(supabase), databaseError)
})
