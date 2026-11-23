'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PAGE_SIZE = 30

// Paged friend list shared by the share pickers. Callers own their markup and
// share action; this owns loading, keyset paging, de-duplication and retry.
export function useFriendPicker({ disabled = false } = {}) {
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

  return { friends, loaded, loading, error, hasMore, loadPage, retry: () => loadPage(retryCursor.current) }
}
