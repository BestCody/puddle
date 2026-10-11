import test from 'node:test'
import assert from 'node:assert/strict'
import { getSocialHubSnapshot } from '../../lib/app/social-hub-data.js'

test('text conversations and nullable previews never send null strings to the UUID reader', async () => {
  const calls = []
  const locationId = '01d5fefa-4bca-58c6-bbe7-2f932b747296'
  const supabase = { rpc: async (name, args) => {
    calls.push({ name, args })
    if (name === 'social_conversations_v2') return { data: [{ conversation_id: 'thread', last_location_id: null }], error: null }
    if (name === 'social_messages_v2') return { data: [{ id: 'text', location_id: null }, { id: 'place', location_id: locationId }], error: null }
    if (name === 'location_previews_v1') {
      assert.deepEqual(args.requested_ids, [locationId])
      return { data: [{ location_id: locationId, name: 'Saudade Toronto', slug: 'saudade' }], error: null }
    }
    return { data: [], error: null }
  } }
  const snapshot = await getSocialHubSnapshot({ supabase, user: { id: 'person' }, profile: {} }, 'thread')
  assert.equal(snapshot.messages[0].location_id, null)
  assert.equal(snapshot.messages[1].location_name, 'Saudade Toronto')
  assert.equal(calls.filter(call => call.name === 'location_previews_v1').length, 1)
  calls.length = 0
  await getSocialHubSnapshot({ supabase, user: { id: 'person' }, profile: {} })
  assert.equal(calls.filter(call => call.name === 'location_previews_v1').length, 0)
})
