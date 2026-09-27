// Feed posts and catalogue locations have separate lifecycles. Advance the
// keyset cursor by the last inspected post, not the last visible post, so a
// deleted catalogue row cannot create a repeated or skipped page.
export async function scanVisibleFeedPage({ pageSize, beforeCreatedAt, beforePostId, loadBatch, maxBatches = 3, maxBatchSize = 40 }) {
  const locationsById = new Map()
  const visiblePosts = []
  const commentRows = []
  const states = []
  const timings = { postsMs: 0, locationsMs: 0, commentsMs: 0, statesMs: 0, locationsRequested: 0, locationsResolved: 0 }
  let cursorAt = beforeCreatedAt
  let cursorId = beforePostId
  let lastKey = null
  let hasMore = false

  for (let batch = 0; batch < maxBatches && visiblePosts.length < pageSize; batch += 1) {
    const scanSize = Math.min(maxBatchSize, pageSize * (batch === 0 ? 1 : 4))
    const result = await loadBatch({ beforeCreatedAt: cursorAt, beforePostId: cursorId, limit: scanSize + 1 })
    timings.postsMs += result.postsMs || 0
    const rows = result.rows.slice(0, scanSize)
    if (!rows.length) { hasMore = false; break }

    const { locationResult, commentResult, statesResult } = result
    timings.locationsMs += locationResult.durationMs || 0
    timings.commentsMs += commentResult.durationMs || 0
    timings.statesMs += statesResult.durationMs || 0
    timings.locationsRequested += locationResult.requestedCount || 0
    timings.locationsResolved += locationResult.resolvedCount || 0
    for (const [id, location] of locationResult.locationsById) locationsById.set(id, location)
    commentRows.push(...commentResult.rows)
    states.push(...statesResult.rows)

    for (let index = 0; index < rows.length; index += 1) {
      const post = rows[index]
      lastKey = post
      const location = locationsById.get(String(post.location_id))
      if (location?.status === 'published') visiblePosts.push({ ...post, location })
      if (visiblePosts.length === pageSize) {
        hasMore = index < rows.length - 1 || result.rows.length > scanSize
        break
      }
    }
    if (visiblePosts.length === pageSize) break
    hasMore = result.rows.length > scanSize
    if (!hasMore) break
    cursorAt = lastKey.created_at
    cursorId = lastKey.id
  }

  return { visiblePosts, commentRows, states, locationsById, lastKey, hasMore, timings }
}
