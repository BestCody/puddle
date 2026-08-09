"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { csrfFetch } from '@/lib/security/csrf-client'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function publicMediaUrl(client, path) {
  if (!path) return null
  if (String(path).startsWith('/') || String(path).startsWith('http')) return path
  return client.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function MiniAvatar({ client, person }) {
  const url = publicMediaUrl(client, person?.avatar_path)
  return <span className="social-avatar" title={person?.display_name || person?.username || 'Friend'} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? null : initials(person?.display_name || person?.username)}</span>
}

function SendSheet({ client, item, friends, onClose, onSent }) {
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
        note: note.trim() || null,
        staticCatalogueEphemeral: item.static_catalogue_ephemeral === true,
        staticRef: item.static_ref || null
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
      {friends.length ? <>
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
  const [likedBy, setLikedBy] = useState([])
  const [friends, setFriends] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    const locationId = item?.content_id
    if (!locationId || item?.static_catalogue_ephemeral) {
      setLikedBy([])
    } else {
      client.rpc('friends_who_liked_location_v1', { target_location: locationId }).then(({ data }) => {
        if (active) setLikedBy(data || [])
      })
    }
    client.rpc('social_friends_v1').then(({ data }) => { if (active) setFriends(data || []) })
    return () => { active = false }
  }, [client, item?.content_id, item?.static_catalogue_ephemeral])

  const socialText = likedBy.length === 1
    ? `${likedBy[0].display_name || likedBy[0].username || 'A friend'} saved this`
    : likedBy.length > 1
      ? `${likedBy[0].display_name || likedBy[0].username || 'A friend'} + ${likedBy.length - 1} friend${likedBy.length === 2 ? '' : 's'} saved this`
      : friends.length ? 'Send this place to a friend' : 'Add friends to share places'

  function sent(message, success) {
    onMessage?.(message)
    if (success) setOpen(false)
  }

  return <>
    <div className="discover-social-bar">
      <div className="discover-social-friends">
        {likedBy.length ? <span className="discover-social-avatars">{likedBy.slice(0, 3).map((person) => <MiniAvatar client={client} person={person} key={person.id} />)}</span> : null}
        <span>{socialText}</span>
      </div>
      <button type="button" onClick={() => setOpen(true)}>Send to</button>
    </div>
    {open ? <SendSheet client={client} item={item} friends={friends} onClose={() => setOpen(false)} onSent={sent} /> : null}
  </>
}
