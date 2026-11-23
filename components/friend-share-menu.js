'use client'

import { DismissibleDetails } from './dismissible-details'
import { useFriendPicker } from './friend-picker'

// Shared lazy picker; each caller retains its existing share action.
export function FriendShareMenu({ summary, renderFriend, className, disabled = false }) {
  const { friends, loaded, loading, error, hasMore, loadPage, retry } = useFriendPicker({ disabled })

  return <DismissibleDetails className={className} fitAbove="[aria-label='Puddle mobile navigation']" onOpen={() => { if (!loaded) void loadPage() }}>
    <summary aria-label="Share saved place" aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault() }}>{summary}</summary>
    <div>
      {friends.map(friend => renderFriend(friend))}
      {loading ? <p role="status">Loading friends…</p> : null}
      {error ? <p role="status">{error}</p> : null}
      {error && !loading ? <button type="button" onClick={retry}>Try again</button> : null}
      {loaded && !friends.length && !loading && !error ? <p>Add a friend before sharing.</p> : null}
      {hasMore && !loading && !error ? <button type="button" onClick={() => loadPage(friends.at(-1))}>More friends</button> : null}
    </div>
  </DismissibleDetails>
}
