import test from 'node:test'
import assert from 'node:assert/strict'
import { getLocationPreviews } from '../../lib/app/location-previews.js'

test('preview reads are one bounded RPC, ordered and deduplicated without catalogue fallback', async () => {
  const calls = []
  const supabase = { rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: [{ location_id: 'b', name: 'Cafe', photo_hash: 'a'.repeat(64) }, { location_id: 'a', name: 'Park' }], error: null }
  } }
  assert.deepEqual(await getLocationPreviews(supabase, []), [])
  const rows = await getLocationPreviews(supabase, ['a', 'b', 'a', null, 'hidden'])
  assert.deepEqual(rows.map(row => row.id), ['a', 'b'])
  assert.equal(rows[1].cover_path, `/api/open-photo/${'a'.repeat(64)}`)
  assert.deepEqual(calls, [{ name: 'location_previews_v1', args: { requested_ids: ['a', 'b', 'hidden'] } }])
  await assert.rejects(getLocationPreviews(supabase, Array.from({ length: 101 }, (_, i) => String(i))), RangeError)
})

test('preview failures remain errors rather than empty data or full-catalogue reads', async () => {
  const error = new Error('Database unavailable')
  await assert.rejects(getLocationPreviews({ rpc: async () => ({ data: null, error }) }, ['a']), error)
  await assert.rejects(getLocationPreviews({ rpc: async () => ({ data: null, error: null }) }, ['a']), /invalid response/)
})
