"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { PhotoFrame } from '@/components/photo-frame'
import { createClient } from '@/lib/supabase/client'
import { csrfFetch } from '@/lib/security/csrf-client'

const SHARE_ICON = 'data:image/png;base64,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'

function publicMediaUrl(client, path) {
  if (!path) return null
  if (String(path).startsWith('/') || String(path).startsWith('http')) return path
  return client.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function MiniAvatar({ client, person }) {
  const url = publicMediaUrl(client, person?.avatar_path)
  const name = person?.display_name || person?.username || 'Friend'
  return <PhotoFrame as="span" src={url} alt="" className="social-avatar" title={name} unavailableText={name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'} loadingText="" />
}

function SendSheet({ client, item, friends, friendsLoading, friendsError, onRetry, onClose, onSent }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const title = item.title || item.name || 'this place'

  async function send(friend) {
    if (busy) return
    setBusy(friend.id)
    const response = await csrfFetch('/api/social/share-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friendId: friend.id,
        locationId: item.content_id,
        note: note.trim() || null
      })
    })
    const result = await response.json().catch(() => ({}))
    setBusy(null)
    if (!response.ok) return onSent(result.error || 'Could not send that place.', false)
    onSent(`Sent to ${friend.display_name || friend.username || 'your friend'}.`, true)
  }

  return <div className="social-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="social-profile-sheet send-sheet" role="dialog" aria-modal="true" aria-label={`Send ${title} to a friend`}>
      <button className="social-sheet-close" type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close">×</button>
      <h2>Send to</h2>
      <p>{title}</p>
      {friendsLoading ? <div className="social-empty" role="status"><strong>Loading friends...</strong></div> : friendsError ? <div className="social-empty" role="alert"><strong>{friendsError}</strong><button type="button" onClick={onRetry}>Try again</button></div> : friends.length ? <>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note (optional)" maxLength={1000} />
        <div>{friends.map((friend) => <div className="social-person-row" key={friend.id}>
          <MiniAvatar client={client} person={friend} />
          <div className="social-person-copy"><strong>{friend.display_name || 'Puddle person'}</strong>{friend.username ? <span>@{friend.username}</span> : null}</div>
          <div className="social-row-actions"><button className="is-dark" type="button" onClick={() => send(friend)} disabled={Boolean(busy)}>{busy === friend.id ? 'Sending…' : 'Send'}</button></div>
        </div>)}</div>
      </> : <div className="social-empty"><strong>No friends yet</strong><p>Add a friend first, then you can send places directly.</p><Link href="/matches">Find friends</Link></div>}
    </section>
  </div>
}

export function DiscoverSocialBar({ item, onMessage }) {
  const client = useMemo(() => createClient(), [])
  const [friends, setFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [friendsError, setFriendsError] = useState('')
  const [friendsRetry, setFriendsRetry] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    setFriendsLoading(true)
    setFriendsError('')
    client.rpc('social_friends_v2', { before_name: null, before_id: null, result_limit: 100 })
      .then(({ data, error }) => {
        if (error) throw error
        if (active) setFriends(data || [])
      })
      .catch(() => {
        if (active) {
          setFriends([])
          setFriendsError('Friends could not be loaded.')
        }
      })
      .finally(() => { if (active) setFriendsLoading(false) })
    return () => { active = false }
  }, [client, friendsRetry])

  function sent(message, success) {
    onMessage?.(message)
    if (success) setOpen(false)
  }

  return <>
    <button className="discover-share-trigger" type="button" aria-label="Send to" title="Send to" onClick={() => setOpen(true)}>
      <img src={SHARE_ICON} alt="" aria-hidden="true" />
    </button>
    {open ? <SendSheet client={client} item={item} friends={friends} friendsLoading={friendsLoading} friendsError={friendsError} onRetry={() => setFriendsRetry((value) => value + 1)} onClose={() => setOpen(false)} onSent={sent} /> : null}
  </>
}
