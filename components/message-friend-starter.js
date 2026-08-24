"use client"

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './message-friend-starter.module.css'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function avatarUrl(client, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || value.startsWith('http')) return value
  return client.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

export function MessageFriendStarter({ friends = [] }) {
  const router = useRouter()
  const rootRef = useRef(null)
  const [client] = useState(() => createClient())
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!open) return undefined

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function openConversation(friend) {
    if (!friend?.id || busyId) return
    setBusyId(friend.id)
    setErrorMessage('')

    const { data, error } = await client.rpc('social_open_direct_conversation_v1', { target: friend.id })
    if (error || !data) {
      setBusyId(null)
      setErrorMessage(error?.message || 'Could not start that conversation.')
      return
    }

    setOpen(false)
    setBusyId(null)
    router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    router.refresh()
  }

  return <div className={styles.root} ref={rootRef}>
    {friends.length ? <>
      <button
        className={styles.trigger}
        type="button"
        onClick={() => {
          setErrorMessage('')
          setOpen((current) => !current)
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span>New message</span><b aria-hidden="true">＋</b>
      </button>

      {open ? <div className={styles.picker} role="dialog" aria-label="Start a conversation">
        <div className={styles.heading}><strong>Start a conversation</strong><small>Choose a friend</small></div>
        <div className={styles.list}>
          {friends.map((friend) => {
            const name = friend.display_name || friend.username || 'Puddle person'
            const url = avatarUrl(client, friend.avatar_path || friend.friend_avatar_path)
            return <button type="button" onClick={() => openConversation(friend)} disabled={Boolean(busyId)} key={friend.id}>
              <span className={styles.avatar} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? null : initials(name)}</span>
              <span className={styles.person}><strong>{name}</strong>{friend.username ? <small>@{friend.username}</small> : <small>Start chatting</small>}</span>
              <b className={styles.arrow}>{busyId === friend.id ? '…' : '→'}</b>
            </button>
          })}
        </div>
        {errorMessage ? <p className={styles.error} role="status">{errorMessage}</p> : null}
      </div> : null}
    </> : <Link className={styles.trigger} href="/matches?tab=add"><span>Add a friend to message</span><b aria-hidden="true">＋</b></Link>}
  </div>
}
