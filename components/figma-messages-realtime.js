"use client"

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhotoFrame } from '@/components/photo-frame'
import { RoutedSegment } from '@/components/routed-segment'
import { createClient } from '@/lib/supabase/client'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function mediaUrl(client, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || value.startsWith('http')) return value
  return client.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function Avatar({ client, person }) {
  const path = person?.avatar_path || person?.friend_avatar_path || person?.sender_avatar_path
  const name = person?.display_name || person?.friend_name || person?.sender_name || 'Puddle person'
  const url = mediaUrl(client, path)
  return <PhotoFrame as="span" src={url} alt="" className="figma-friends-avatar" unavailableText={initials(name)} loadingText="" />
}

function MessagesTabs() {
  return <RoutedSegment
    className="figma-friends-tabs"
    tone="green"
    activeValue="messages"
    ariaLabel="Friends sections"
    items={[
      { value: 'messages', label: 'Message', href: '/matches?tab=messages' },
      { value: 'shared', label: 'Shared', href: '/matches?tab=shared' },
      { value: 'add', label: 'Add', href: '/matches?tab=add' }
    ]}
  />
}

function mergeById(current, incoming, key = 'id') {
  const merged = new Map(current.map((item) => [item[key], item]))
  for (const item of incoming || []) merged.set(item[key], item)
  return [...merged.values()]
}

function conversationList(snapshot, selected, source = snapshot.conversations || []) {
  const base = selected && !source.some((item) => item.conversation_id === selected.conversation_id)
    ? [selected, ...source]
    : [...source]
  const friendIds = new Set(base.map((item) => item.friend_id).filter(Boolean))
  const waiting = (snapshot.friends || []).filter((friend) => !friendIds.has(friend.id)).map((friend) => ({
    conversation_id: null,
    friend_id: friend.id,
    display_name: friend.display_name,
    username: friend.username,
    avatar_path: friend.avatar_path,
    last_message: null,
    unread_count: 0,
    is_friend_placeholder: true
  }))
  return [...base, ...waiting]
}

export function FigmaMessagesRealtime({ initialSnapshot }) {
  const client = useMemo(() => createClient(), [])
  const router = useRouter()
  const selected = initialSnapshot.selectedConversation
  const selectedId = selected?.conversation_id || null
  const placeMenuRef = useRef(null)
  const messageScrollRef = useRef(null)
  const [conversations, setConversations] = useState(() => conversationList(initialSnapshot, selected))
  const [conversationsHasMore, setConversationsHasMore] = useState(Boolean(initialSnapshot.conversationsHasMore))
  const [messages, setMessages] = useState(initialSnapshot.messages || [])
  const [messagesHasMore, setMessagesHasMore] = useState(Boolean(initialSnapshot.messagesHasMore))
  const [shareableLocations, setShareableLocations] = useState(initialSnapshot.shareableLocations || [])
  const [shareableLocationsLoaded, setShareableLocationsLoaded] = useState(Boolean(initialSnapshot.shareableLocations?.length))
  const [shareableLocationsLoading, setShareableLocationsLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [paging, setPaging] = useState(false)
  const [openingFriendId, setOpeningFriendId] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setConversations(conversationList(initialSnapshot, selected))
    setConversationsHasMore(Boolean(initialSnapshot.conversationsHasMore))
  }, [initialSnapshot.conversations, initialSnapshot.friends, initialSnapshot.conversationsHasMore, selectedId])

  useEffect(() => {
    setMessages(initialSnapshot.messages || [])
    setMessagesHasMore(Boolean(initialSnapshot.messagesHasMore))
  }, [initialSnapshot.messages, initialSnapshot.messagesHasMore, selectedId])

  const latestMessageId = messages.length ? messages[messages.length - 1]?.id : null
  useEffect(() => {
    const node = messageScrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [selectedId, latestMessageId])

  async function loadShareableLocations() {
    if (shareableLocationsLoaded || shareableLocationsLoading) return
    setShareableLocationsLoading(true)
    let loaded = false
    try {
      const response = await fetch('/api/saved-location-options', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Saved locations returned ${response.status}`)
      const payload = await response.json()
      setShareableLocations(Array.isArray(payload?.items) ? payload.items : [])
      setNotice('')
      loaded = true
    } catch (cause) {
      console.warn('Could not load saved places for messaging.', { message: cause?.message || 'unknown error' })
      setShareableLocations([])
      setNotice('Saved places could not be loaded.')
    } finally {
      setShareableLocationsLoaded(loaded)
      setShareableLocationsLoading(false)
    }
  }

  async function markSelectedRead() {
    if (!selectedId) return
    try {
      await client.rpc('social_mark_conversation_read_v1', { target: selectedId, last_message: null })
    } catch {}
  }

  async function refreshMessages() {
    if (!selectedId) return false
    try {
      const { data, error } = await client.rpc('social_messages_v2', {
        target: selectedId,
        before_message_id: null,
        result_limit: 50
      })
      if (!error && data) {
        setMessages(data)
        setMessagesHasMore(data.length === 50)
        return true
      }
    } catch (cause) {
      console.warn('Could not refresh messages.', { message: cause?.message || 'unknown error' })
    }
    return false
  }

  async function refreshConversations() {
    try {
      const { data, error } = await client.rpc('social_conversations_v2', {
        before_sort_at: null,
        before_conversation_id: null,
        result_limit: 30
      })
      if (!error && data) {
        setConversations(conversationList(initialSnapshot, selected, data))
        setConversationsHasMore(data.length === 30)
      }
    } catch {}
  }

  useEffect(() => {
    let active = true

    async function initializeReadState() {
      if (!selectedId || !active) return
      await markSelectedRead()
      if (active) await refreshConversations()
    }
    initializeReadState()

    const channel = client
      .channel(`figma-messages-realtime-${initialSnapshot.self.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async (payload) => {
        if (!active) return
        const changedConversationId = payload?.new?.conversation_id || payload?.old?.conversation_id || null
        if (changedConversationId === selectedId) {
          await refreshMessages()
          await markSelectedRead()
        }
        if (active) await refreshConversations()
      })
      .subscribe()

    return () => {
      active = false
      client.removeChannel(channel)
    }
  }, [client, initialSnapshot.self.id, selectedId])

  async function openConversation(conversation) {
    if (conversation.conversation_id) {
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}`)
      return
    }
    if (!conversation.friend_id || openingFriendId) return
    setOpeningFriendId(conversation.friend_id)
    setNotice('')
    try {
      const { data, error } = await client.rpc('social_open_direct_conversation_v1', { target: conversation.friend_id })
      if (error || !data) {
        setNotice('Could not open that conversation.')
        return
      }
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    } catch {
      setNotice('Could not open that conversation.')
    } finally {
      setOpeningFriendId(null)
    }
  }

  async function loadOlderMessages() {
    if (!selectedId || !messages.length || paging || !messagesHasMore) return
    setPaging(true)
    const oldest = messages[0]
    try {
      const { data, error } = await client.rpc('social_messages_v2', {
        target: selectedId,
        before_message_id: oldest.id,
        result_limit: 50
      })
      if (!error) {
        setMessages((current) => mergeById(data || [], current))
        setMessagesHasMore((data || []).length === 50)
      }
      if (error || !data) setNotice('Older messages could not be loaded.')
    } catch (cause) {
      console.warn('Could not load older messages.', { message: cause?.message || 'unknown error' })
      setNotice('Older messages could not be loaded.')
    } finally {
      setPaging(false)
    }
  }

  async function loadMoreConversations() {
    if (!conversationsHasMore || paging) return
    const cursor = [...conversations].reverse().find((item) => item.sort_at && item.conversation_id)
    if (!cursor) {
      setConversationsHasMore(false)
      return
    }
    setPaging(true)
    try {
      const { data, error } = await client.rpc('social_conversations_v2', {
        before_sort_at: cursor.sort_at,
        before_conversation_id: cursor.conversation_id,
        result_limit: 30
      })
      if (!error) {
        setConversations((current) => {
          const placeholders = current.filter((item) => item.is_friend_placeholder)
          const real = current.filter((item) => !item.is_friend_placeholder)
          const merged = mergeById(real, data || [], 'conversation_id')
          const friendIds = new Set(merged.map((item) => item.friend_id).filter(Boolean))
          return [...merged, ...placeholders.filter((item) => !friendIds.has(item.friend_id))]
        })
        setConversationsHasMore((data || []).length === 30)
      }
      if (error || !data) setNotice('More conversations could not be loaded.')
    } catch (cause) {
      console.warn('Could not load more conversations.', { message: cause?.message || 'unknown error' })
      setNotice('More conversations could not be loaded.')
    } finally {
      setPaging(false)
    }
  }

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selectedId || busy) return
    setBusy(true)
    setNotice('')
    try {
      const { error } = await client.rpc('social_send_message_v1', { target: selectedId, message_body: body })
      if (error) {
        setNotice('Could not send that message.')
        return
      }
      setDraft('')
      if (!await refreshMessages()) setNotice('Message sent, but the conversation could not be refreshed.')
      await markSelectedRead()
      await refreshConversations()
    } catch {
      setNotice('Could not send that message.')
    } finally {
      setBusy(false)
    }
  }

  async function sendLocation(locationId) {
    if (!selectedId || busy) return
    setBusy(true)
    setNotice('')
    try {
      const { error } = await client.rpc('social_send_location_message_v1', { target: selectedId, target_location: locationId })
      if (error) {
        setNotice('Could not attach that place.')
        return
      }
      placeMenuRef.current?.removeAttribute('open')
      await refreshMessages()
      await markSelectedRead()
      await refreshConversations()
    } catch {
      setNotice('Could not attach that place.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="figma-friends-screen is-messages">
    <MessagesTabs />
    <div className="figma-friends-message-layout">
      <aside className="figma-friends-conversations" aria-label="Conversations">
        {conversations.length ? conversations.map((conversation) => <button
          className={selectedId && selectedId === conversation.conversation_id ? 'is-active' : ''}
          type="button"
          onClick={() => openConversation(conversation)}
          disabled={openingFriendId === conversation.friend_id}
          key={conversation.conversation_id || `friend:${conversation.friend_id}`}
        >
          <Avatar client={client} person={{ display_name: conversation.display_name, avatar_path: conversation.avatar_path }} />
          <span><strong>{conversation.display_name || conversation.username || 'Friend'}</strong><small>{conversation.last_message || (openingFriendId === conversation.friend_id ? 'Opening…' : 'Start a conversation')}</small></span>
          {conversation.unread_count > 0 ? <b>{conversation.unread_count}</b> : null}
        </button>) : <div className="figma-friends-conversation-empty">No conversations yet</div>}
        {conversationsHasMore ? <button type="button" onClick={loadMoreConversations} disabled={paging}>Load more conversations</button> : null}
      </aside>

      <section className="figma-friends-chat">
        {selected ? <>
          <header><Avatar client={client} person={{ display_name: selected.display_name, avatar_path: selected.avatar_path }} /><span><strong>{selected.display_name || selected.username || 'Friend'}</strong>{selected.username ? <small>@{selected.username}</small> : null}</span></header>
          <div className="figma-friends-messages" ref={messageScrollRef} aria-live="polite">
            {messagesHasMore ? <button type="button" onClick={loadOlderMessages} disabled={paging}>Load older messages</button> : null}
            {messages.length ? messages.map((item) => {
              const mine = item.sender_id === initialSnapshot.self.id
              return <div className={`figma-friends-message${mine ? ' is-mine' : ''}`} key={item.id}>
                {!mine ? <Avatar client={client} person={item} /> : null}
                <div>{item.message_type === 'location' && item.location_slug ? <Link className="figma-friends-location-message" href={`/plans/${item.location_slug}`}><strong>{item.location_name || 'Shared place'}</strong><small>{item.location_city || 'Open place'}</small></Link> : <p>{item.body}</p>}</div>
              </div>
            }) : <div className="figma-friends-chat-empty">Say hello</div>}
          </div>
          {notice ? <p className="figma-friends-chat-notice" role="status">{notice}</p> : null}
          <form className="figma-friends-composer puddle-text-composer" onSubmit={send}>
            <details
              className="figma-friends-composer-menu is-attachment"
              ref={placeMenuRef}
              onToggle={(event) => {
                if (event.currentTarget.open) loadShareableLocations()
              }}
            >
              <summary aria-label="Add a place" title="Add a place">+</summary>
              <div className="figma-message-place-picker"><strong>Share a saved place</strong>{shareableLocationsLoading ? <p>Loading saved places...</p> : shareableLocations.length ? shareableLocations.map((location) => <button type="button" onClick={() => sendLocation(location.id)} disabled={busy} key={location.id}><span>{location.name}</span><small>{location.city || 'Saved place'}</small></button>) : <p>No saved places yet.</p>}</div>
            </details>
            <details className="figma-friends-composer-menu is-more">
              <summary aria-label="More message options">○</summary>
              <div><Link href="/matches?tab=shared">View shared puddles</Link><Link href="/plans">Open Saved</Link></div>
            </details>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Text Message" maxLength={5000} />
            <button className="is-send puddle-send-action" type="submit" disabled={!draft.trim() || busy} aria-label="Send message">↑</button>
          </form>
        </> : <div className="figma-friends-chat-empty">Select a conversation</div>}
      </section>
    </div>
  </div>
}
