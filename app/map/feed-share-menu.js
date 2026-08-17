"use client"

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shareFeedPost } from './actions'
import styles from './MapFeed.module.css'

function mergeFriends(current, incoming) {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming || []) merged.set(item.id, item)
  return [...merged.values()]
}

export function FeedShareMenu({ postId, title }) {
  const client = useMemo(() => createClient(), [])
  const [friends, setFriends] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  async function loadPage(cursor = null) {
    if (loading) return
    setLoading(true)
    const { data, error } = await client.rpc('social_friends_v2', {
      before_name: cursor?.sort_name || null,
      before_id: cursor?.id || null,
      result_limit: 30
    })
    if (!error) {
      const rows = data || []
      setFriends((current) => cursor ? mergeFriends(current, rows) : rows)
      setHasMore(rows.length === 30)
      setLoaded(true)
    }
    setLoading(false)
  }

  function onToggle(event) {
    if (event.currentTarget.open && !loaded && !loading) loadPage()
  }

  async function loadMore() {
    const cursor = friends[friends.length - 1]
    if (cursor) await loadPage(cursor)
  }

  return <details className={styles.actionMenu} onToggle={onToggle}>
    <summary aria-label={`Share ${title}`}>↗</summary>
    <div className={`${styles.actionPanel} ${styles.sharePanel}`}>
      <strong>Share with a friend</strong>
      {friends.map((friend) => <form action={shareFeedPost} key={friend.id}>
        <input type="hidden" name="post_id" value={postId} />
        <input type="hidden" name="friend_id" value={friend.id} />
        <button type="submit">{friend.display_name || friend.username || 'Friend'}</button>
      </form>)}
      {loading ? <p>Loading friends…</p> : null}
      {loaded && !friends.length && !loading ? <p>Add a friend before sharing.</p> : null}
      {hasMore && !loading ? <button type="button" onClick={loadMore}>More friends</button> : null}
    </div>
  </details>
}
