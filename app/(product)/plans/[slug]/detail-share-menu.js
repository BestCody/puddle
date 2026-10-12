"use client"

import { FriendShareMenu } from '@/components/friend-share-menu'
import { shareSavedPlace } from './actions'
import styles from '../Plans.module.css'

export function DetailShareMenu({ locationId, slug }) {
  return <FriendShareMenu className={styles.share} summary={<img src="/figma/saved-place-share.svg" alt="" aria-hidden="true" />} renderFriend={friend => <form action={shareSavedPlace} onSubmit={(event) => { const input = event.currentTarget.elements.namedItem('share_key'); if (!input.value) input.value = crypto.randomUUID() }} key={friend.id}>
        <input type="hidden" name="location_id" value={locationId} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="friend_id" value={friend.id} />
        <input type="hidden" name="share_key" defaultValue="" />
        <button type="submit">{friend.display_name || friend.username || 'Friend'}</button>
      </form>} />
}
