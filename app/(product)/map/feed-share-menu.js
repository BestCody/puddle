"use client"

import { DismissibleDetails } from '@/components/dismissible-details'
import { ShareIcon } from '@/components/feed-action-icons'
import { useFriendPicker } from '@/components/friend-picker'
import { shareFeedPost } from './actions'
import styles from './MapFeed.module.css'

export function FeedShareMenu({ postId, title }) {
  const { friends, loaded, loading, error, hasMore, loadPage, retry } = useFriendPicker()

  function onOpen() {
    if (!loaded && !loading) loadPage()
  }

  async function loadMore() {
    const cursor = friends[friends.length - 1]
    if (cursor) await loadPage(cursor)
  }

  return <DismissibleDetails className={styles.actionMenu} onOpen={onOpen}>
    <summary aria-label={`Share ${title}`}><ShareIcon classes={styles} /></summary>
    <div className={`${styles.actionPanel} ${styles.sharePanel}`}>
      <strong>Share with a friend</strong>
      {friends.map((friend) => <form action={shareFeedPost} onSubmit={(event) => { const input = event.currentTarget.elements.namedItem('share_key'); if (!input.value) input.value = crypto.randomUUID() }} key={friend.id}>
        <input type="hidden" name="post_id" value={postId} />
        <input type="hidden" name="friend_id" value={friend.id} />
        <input type="hidden" name="share_key" defaultValue="" />
        <button type="submit">{friend.display_name || friend.username || 'Friend'}</button>
      </form>)}
      {loading ? <p>Loading friends…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && !loading ? <button type="button" onClick={retry}>Try again</button> : null}
      {loaded && !friends.length && !loading && !error ? <p>Add a friend before sharing.</p> : null}
      {hasMore && !loading ? <button type="button" onClick={loadMore}>More friends</button> : null}
    </div>
  </DismissibleDetails>
}
