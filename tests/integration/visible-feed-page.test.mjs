import assert from 'node:assert/strict'
import test from 'node:test'
import { scanVisibleFeedPage } from '../../lib/app/visible-feed-page.js'

function posts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `post-${count - index}`,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, count - index)).toISOString(),
    location_id: `location-${count - index}`
  }))
}

function batchLoader(allPosts, visibleIds, calls) {
  return async ({ beforePostId, limit }) => {
    calls.push({ beforePostId, limit })
    const start = beforePostId ? allPosts.findIndex((post) => post.id === beforePostId) + 1 : 0
    const rows = allPosts.slice(start, start + limit)
    return {
      rows,
      locationResult: {
        locationsById: new Map(rows.filter((post) => visibleIds.has(post.id)).map((post) => [post.location_id, { status: 'published' }])),
        durationMs: 0,
        requestedCount: rows.length,
        resolvedCount: rows.length
      },
      commentResult: { rows: [], durationMs: 0 },
      statesResult: { rows: [], durationMs: 0 }
    }
  }
}

test('feed scans past missing catalogue rows and keeps a non-repeating cursor', async () => {
  const allPosts = posts(6)
  const calls = []
  const result = await scanVisibleFeedPage({
    pageSize: 3,
    loadBatch: batchLoader(allPosts, new Set(['post-4', 'post-3', 'post-2']), calls)
  })
  assert.deepEqual(result.visiblePosts.map((post) => post.id), ['post-4', 'post-3', 'post-2'])
  assert.equal(result.lastKey.id, 'post-2')
  assert.equal(result.hasMore, true)
  assert.deepEqual(calls.map((call) => call.beforePostId), [undefined, 'post-4'])
})

test('feed scan work stays bounded when no locations are visible', async () => {
  const allPosts = posts(40)
  const calls = []
  const result = await scanVisibleFeedPage({ pageSize: 3, loadBatch: batchLoader(allPosts, new Set(), calls) })
  assert.equal(result.visiblePosts.length, 0)
  assert.equal(result.hasMore, true)
  assert.equal(result.lastKey.id, 'post-14')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map((call) => call.limit), [4, 13, 13])
})
