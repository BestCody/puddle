'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DismissibleDetails } from './dismissible-details'

const PAGE_SIZE = 30

// Shared lazy picker; each caller retains its existing share action.
export function FriendShareMenu({ summary, renderFriend, className, disabled = false }) {
  const client = useMemo(() => createClient(), [])
  const [friends, setFriends] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const pending = useRef(false)
  const retryCursor = useRef(null)

  async function loadPage(cursor = null) {
    if (pending.current || disabled) return
    pending.current = true
    retryCursor.current = cursor
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await client.rpc('social_friend_picker_v2', {
        before_name: cursor?.sort_name || null,
        before_id: cursor?.id || null,
        result_limit: PAGE_SIZE
      })
      if (queryError) throw queryError
      const rows = data || []
      setFriends(current => cursor ? [...new Map([...current, ...rows].map(friend => [friend.id, friend])).values()] : rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoaded(true)
    } catch {
      setError('Friends could not be loaded.')
    } finally {
      pending.current = false
      setLoading(false)
    }
  }

  return <DismissibleDetails className={className} fitAbove="[aria-label='Puddle mobile navigation']" onOpen={() => { if (!loaded) void loadPage() }}>
    <summary aria-label="Share saved place" aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault() }}>{summary}</summary>
    <div>
      {friends.map(friend => renderFriend(friend))}
      {loading ? <p role="status">Loading friends…</p> : null}
      {error ? <p role="status">{error}</p> : null}
      {error && !loading ? <button type="button" onClick={() => loadPage(retryCursor.current)}>Try again</button> : null}
      {loaded && !friends.length && !loading && !error ? <p>Add a friend before sharing.</p> : null}
      {hasMore && !loading && !error ? <button type="button" onClick={() => loadPage(friends.at(-1))}>More friends</button> : null}
    </div>
  </DismissibleDetails>
}
