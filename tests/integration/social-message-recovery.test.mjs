import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { lastInboxCursor } from '../../lib/app/social-inbox-cursor.js'
import { mergeById, sortConversations, conversationList } from '../../lib/app/social-message-model.js'

test('message refresh preserves hydrated metadata only for the same shared place', () => {
  const current = [{ id: 'message', location_id: 'park', location_name: 'Park', location_slug: 'park' }]
  assert.deepEqual(mergeById(current, [{ id: 'message', location_id: 'park', location_name: null }]), current)
  const changed = mergeById(current, [{ id: 'message', location_id: 'cafe', location_name: 'Cafe' }])[0]
  assert.equal(changed.location_name, 'Cafe')
  assert.equal(changed.location_slug, null)
  const text = mergeById(current, [{ id: 'message', location_id: null, body: 'Hello' }])[0]
  assert.equal(text.location_name, null)
  assert.equal(text.location_slug, null)
})

test('inbox merge keeps loaded pages, sorts deterministically, and avoids duplicate friend placeholders', () => {
  const first = { conversation_id: 'a', friend_id: 'friend-a', sort_at: '2026-10-10T12:00:00Z' }
  const second = { conversation_id: 'b', friend_id: 'friend-b', sort_at: first.sort_at }
  const merged = mergeById([first, second], [{ ...first, unread_count: 0 }], 'conversation_id')
  assert.deepEqual(sortConversations(merged).map(row => row.conversation_id), ['b', 'a'])
  assert.equal(merged[0].unread_count, 0)
  const list = conversationList({ friends: [{ id: 'friend-a' }, { id: 'friend-c' }] }, null, merged)
  assert.equal(list.length, 3)
  assert.equal(list[2].friend_id, 'friend-c')
  assert.equal(list[2].is_friend_placeholder, true)
  assert.equal(conversationList({ conversations: [first] }, second).length, 2)
})

test('inbox pagination uses the last fetched page row, not an older opened conversation', () => {
  const page = [
    { conversation_id: 'first', sort_at: '2026-09-28T12:00:00Z' },
    { conversation_id: 'second', sort_at: '2026-09-28T11:00:00Z' }
  ]
  const displayed = [...page, { conversation_id: 'opened-old-thread', sort_at: '2026-09-20T00:00:00Z' }]

  assert.deepEqual(lastInboxCursor(page), {
    conversation_id: 'second',
    sort_at: '2026-09-28T11:00:00Z'
  })
  assert.notDeepEqual(lastInboxCursor(page), lastInboxCursor(displayed))
  assert.equal(lastInboxCursor([]), null)
  assert.equal(lastInboxCursor([{ conversation_id: 'placeholder' }]), null)
})

test('message and location sends reconcile only after the send succeeds', async () => {
  const ui = await readFile(new URL('../../components/figma-messages-realtime.js', import.meta.url), 'utf8')
  assert.match(ui, /const inboxCursorRef = useRef\(lastInboxCursor\(initialSnapshot\.conversations\)\)/)
  assert.match(ui, /const cursor = inboxCursorRef\.current/)
  assert.doesNotMatch(ui, /\[\.\.\.conversations\]\.reverse\(\)\.find/)
  assert.match(ui, /async function reconcileSentMessage\(scope\)/)
  assert.match(ui, /Sent, but the conversation could not be fully refreshed/)
  assert.match(ui, /if \(error \|\| !data\) throw error \|\| new Error\('Message was not accepted\.'\)/)
  assert.match(ui, /if \(error \|\| !data\) throw error \|\| new Error\('Place was not attached\.'\)/)
  assert.match(ui, /if \(error \|\| !Array\.isArray\(data\)\) throw error \|\| new Error\('Conversation page was invalid\.'\)/)
  assert.match(ui, /if \(error \|\| !Array\.isArray\(data\)\) throw error \|\| new Error\('Friend page was invalid\.'\)/)
  assert.match(ui, /async function send\(event\)[\s\S]*?setDraft\(''\)[\s\S]*?await reconcileSentMessage\(scope\)/)
  assert.match(ui, /async function sendLocation\(locationId\)[\s\S]*?locationShareKeysRef\.current\.delete\(requestId\)[\s\S]*?await reconcileSentMessage\(scope\)/)
  const shareRoute = await readFile(new URL('../../app/api/social/share-location/route.js', import.meta.url), 'utf8')
  assert.match(shareRoute, /shared\.error \|\| !shared\.data\?\.conversationId \|\| !shared\.data\?\.messageId \|\| !shared\.data\?\.shareId/)
  const friendUi = await readFile(new URL('../../components/figma-social-hub.js', import.meta.url), 'utf8')
  assert.match(friendUi, /Shared-place page was invalid\./)
  assert.match(friendUi, /Friend search response was invalid\./)
  assert.match(friendUi, /async function request\(person\) \{\s*if \(!person\?\.id \|\| pendingTarget\) return/)
  assert.match(friendUi, /async function respond\(person, response\) \{\s*if \(!person\?\.id \|\| pendingTarget\) return/)
  assert.doesNotMatch(friendUi, /disabled=\{pendingTarget === person\.id\}/)
  assert.match(friendUi, /if \(error \|\| !\['accepted', 'pending'\]\.includes\(data\)\)/)
  assert.match(friendUi, /if \(error \|\| data !== true\)/)
})
