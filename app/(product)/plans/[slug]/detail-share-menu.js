"use client"

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { shareSavedPlace } from './actions'
import styles from '../Plans.module.css'

function mergeFriends(current, incoming) {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming || []) merged.set(item.id, item)
  return [...merged.values()]
}

export function DetailShareMenu({ locationId, slug }) {
  const client = useMemo(() => createClient(), [])
  const [friends, setFriends] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  async function loadPage(cursor = null) {
    if (loading) return
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await client.rpc('social_friend_picker_v2', {
      before_name: cursor?.sort_name || null,
      before_id: cursor?.id || null,
      result_limit: 30
    })
    if (queryError) setError('Friends could not be loaded.')
    else {
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

  return <details className={styles.share} onToggle={onToggle}>
    <summary aria-label="Share saved place"><img src="/figma/saved-place-share.svg" alt="" aria-hidden="true" /></summary>
    <div>
      {friends.map((friend) => <form action={shareSavedPlace} key={friend.id}>
        <input type="hidden" name="location_id" value={locationId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="friend_id" value={friend.id} />
        <button type="submit">{friend.display_name || friend.username || 'Friend'}</button>
      </form>)}
      {loading ? <p>Loading friends…</p> : null}
      {error ? <p role="status">{error}</p> : null}
      {loaded && !friends.length && !loading ? <p>Add a friend before sharing.</p> : null}
      {hasMore && !loading ? <button type="button" onClick={() => loadPage(friends[friends.length - 1])}>More friends</button> : null}
    </div>
  </details>
}
