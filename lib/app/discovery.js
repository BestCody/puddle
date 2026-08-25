import { randomUUID } from 'node:crypto'
import { getGlobalDiscoveryFeed } from './discovery-global.js'
import { suspendedLocationIds } from './location-moderation-overlay.js'

// No fallbacks: discovery serving failures throw and surface as request
// errors. There is no stale-cache serving, no circuit breaker, and no
// degraded empty-feed path — the serving boundary either works or fails.

export async function getDiscoveryFeed(session, filters = {}, options = {}) {
  const feed = await withoutModeratedLocations(
    session,
    await getGlobalDiscoveryFeed(session, filters, options)
  )
  return { ...feed, requestId: randomUUID() }
}

async function withoutModeratedLocations(session, feed) {
  const items = Array.isArray(feed?.items) ? feed.items : []
  if (!items.length || !session?.supabase) return feed
  const suspended = await suspendedLocationIds(session.supabase, items.map((item) => item.content_id))
  if (!suspended.size) return feed
  const visible = items.filter((item) => !suspended.has(String(item.content_id)))
  return {
    ...feed,
    items: visible,
    categories: [...new Set(visible.map((item) => item.category).filter(Boolean))].sort()
  }
}
