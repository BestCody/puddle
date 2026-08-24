"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function mediaUrl(client, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || value.startsWith('http')) return value
  return client.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function Avatar({ client, person, className = '' }) {
  const path = person?.avatar_path || person?.friend_avatar_path || person?.sender_avatar_path
  const name = person?.display_name || person?.friend_name || person?.sender_name || 'Puddle person'
  const url = mediaUrl(client, path)
  return <span className={`figma-friends-avatar ${className}`} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? null : initials(name)}</span>
}

function FriendsTabs({ tab }) {
  return <nav className="figma-dashboard-segment figma-friends-tabs" aria-label="Friends sections">
    <Link className={tab === 'messages' ? 'is-active' : ''} href="/matches?tab=messages">Message</Link>
    <Link className={tab === 'shared' ? 'is-active' : ''} href="/matches?tab=shared">Shared</Link>
    <Link className={tab === 'add' ? 'is-active' : ''} href="/matches?tab=add">Add</Link>
  </nav>
}

function mergeById(current, incoming, key = 'id') {
  const merged = new Map(current.map((item) => [item[key], item]))
  for (const item of incoming || []) merged.set(item[key], item)
  return [...merged.values()]
}

function conversationList(snapshot, selected) {
  const base = selected && !snapshot.conversations.some((item) => item.conversation_id === selected.conversation_id)
    ? [selected, ...snapshot.conversations]
    : [...snapshot.conversations]
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

function MessagesView({ client, snapshot }) {
  const router = useRouter()
  const selected = snapshot.selectedConversation
  const [conversations, setConversations] = useState(() => conversationList(snapshot, selected))
  const [conversationsHasMore, setConversationsHasMore] = useState(Boolean(snapshot.conversationsHasMore))
  const [messages, setMessages] = useState(snapshot.messages || [])
  const [messagesHasMore, setMessagesHasMore] = useState(Boolean(snapshot.messagesHasMore))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [paging, setPaging] = useState(false)
  const [openingFriendId, setOpeningFriendId] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setConversations(conversationList(snapshot, selected))
    setConversationsHasMore(Boolean(snapshot.conversationsHasMore))
  }, [snapshot.conversations, snapshot.friends, snapshot.conversationsHasMore, selected?.conversation_id])
  useEffect(() => {
    setMessages(snapshot.messages || [])
    setMessagesHasMore(Boolean(snapshot.messagesHasMore))
  }, [snapshot.messages, snapshot.messagesHasMore, selected?.conversation_id])
  useEffect(() => {
    if (!selected?.conversation_id) return
    client.rpc('social_mark_conversation_read_v1', { target: selected.conversation_id, last_message: null }).catch(() => {})
  }, [client, selected?.conversation_id])

  async function openConversation(conversation) {
    if (conversation.conversation_id) {
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}`)
      return
    }
    if (!conversation.friend_id || openingFriendId) return
    setOpeningFriendId(conversation.friend_id)
    setMessage('')
    const { data, error } = await client.rpc('social_open_direct_conversation_v1', { target: conversation.friend_id })
    setOpeningFriendId(null)
    if (error || !data) {
      setMessage('Could not open that conversation.')
      return
    }
    router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    router.refresh()
  }

  async function reloadMessages() {
    if (!selected) return
    const { data } = await client.rpc('social_messages_v2', {
      target: selected.conversation_id,
      before_message_id: null,
      result_limit: 50
    })
    if (data) {
      setMessages(data)
      setMessagesHasMore(data.length === 50)
    }
  }

  async function loadOlderMessages() {
    if (!selected || !messages.length || paging || !messagesHasMore) return
    setPaging(true)
    const oldest = messages[0]
    const { data, error } = await client.rpc('social_messages_v2', {
      target: selected.conversation_id,
      before_message_id: oldest.id,
      result_limit: 50
    })
    if (!error) {
      setMessages((current) => mergeById(data || [], current))
      setMessagesHasMore((data || []).length === 50)
    }
    setPaging(false)
  }

  async function loadMoreConversations() {
    if (!conversationsHasMore || paging || !conversations.length) return
    const cursor = [...conversations].reverse().find((item) => item.sort_at && item.conversation_id)
    if (!cursor) return setConversationsHasMore(false)
    setPaging(true)
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
    setPaging(false)
  }

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selected || busy) return
    setBusy(true)
    setMessage('')
    const { error } = await client.rpc('social_send_message_v1', { target: selected.conversation_id, message_body: body })
    if (!error) {
      setDraft('')
      await reloadMessages()
    } else setMessage('Could not send that message.')
    setBusy(false)
  }

  async function sendLocation(locationId) {
    if (!selected || busy) return
    setBusy(true)
    setMessage('')
    const { error } = await client.rpc('social_send_location_message_v1', { target: selected.conversation_id, target_location: locationId })
    if (!error) await reloadMessages()
    else setMessage('Could not attach that place.')
    setBusy(false)
  }

  return <div className="figma-friends-message-layout">
    <aside className="figma-friends-conversations" aria-label="Conversations">
      {conversations.length ? conversations.map((conversation) => <button
        className={selected?.conversation_id && selected.conversation_id === conversation.conversation_id ? 'is-active' : ''}
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
        <div className="figma-friends-messages" aria-live="polite">
          {messagesHasMore ? <button type="button" onClick={loadOlderMessages} disabled={paging}>Load older messages</button> : null}
          {messages.length ? messages.map((item) => {
            const mine = item.sender_id === snapshot.self.id
            return <div className={`figma-friends-message${mine ? ' is-mine' : ''}`} key={item.id}>
              {!mine ? <Avatar client={client} person={item} /> : null}
              <div>{item.message_type === 'location' && item.location_slug ? <Link className="figma-friends-location-message" href={`/plans/${item.location_slug}`}><strong>{item.location_name || 'Shared place'}</strong><small>{item.location_city || 'Open place'}</small></Link> : <p>{item.body}</p>}</div>
            </div>
          }) : <div className="figma-friends-chat-empty">Say hello</div>}
        </div>
        {message ? <p className="figma-friends-chat-notice" role="status">{message}</p> : null}
        <form className="figma-friends-composer" onSubmit={send}>
          <details className="figma-friends-composer-menu is-attachment">
            <summary aria-label="Add attachment">+</summary>
            <div><strong>Share a saved place</strong>{snapshot.shareableLocations?.length ? snapshot.shareableLocations.map((location) => <button type="button" onClick={() => sendLocation(location.id)} disabled={busy} key={location.id}><span>{location.name}</span><small>{location.city || 'Saved place'}</small></button>) : <p>No saved places yet.</p>}</div>
          </details>
          <details className="figma-friends-composer-menu is-more">
            <summary aria-label="More message options">○</summary>
            <div><Link href="/matches?tab=shared">View shared puddles</Link><Link href="/plans">Open Saved</Link></div>
          </details>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Text Message" maxLength={5000} />
          <button className="is-send" type="submit" disabled={!draft.trim() || busy} aria-label="Send message">↑</button>
        </form>
      </> : <div className="figma-friends-chat-empty">Select a conversation</div>}
    </section>
  </div>
}

function SharedView({ client, snapshot }) {
  const router = useRouter()
  return <section className="figma-friends-shared-view">
    <h1>Shared puddles</h1>
    <div className="figma-friends-shared-grid">
      {snapshot.shared.length ? snapshot.shared.flatMap((item) => {
        const conversation = snapshot.conversations.find((candidate) => candidate.friend_id === item.friend_id)
        const chatHref = conversation ? `/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}` : '/matches?tab=messages'
        return [
          <article className="figma-friends-shared-place" key={`place:${item.share_id}`}>
            <Link className="figma-friends-shared-photo" href={item.location_slug ? `/plans/${item.location_slug}` : '/plans'} style={mediaUrl(client, item.location_cover_path) ? { backgroundImage: `url(${mediaUrl(client, item.location_cover_path)})` } : undefined} />
            <h2>{item.location_name || 'Shared puddle'}</h2><small>{item.location_city || ''}</small><span>{item.distance_label || ''}</span>
            <b>{item.direction === 'received' ? `Shared by ${item.friend_name || 'friend'}` : `Shared with ${item.friend_name || 'friend'}`}</b>
          </article>,
          <article className="figma-friends-shared-chat" key={`chat:${item.share_id}`}><button type="button" onClick={() => router.push(chatHref)}>Jump to chat</button></article>
        ]
      }) : <div className="figma-friends-shared-empty">No shared puddles yet.</div>}
    </div>
  </section>
}

function AddView({ client, snapshot }) {
  const router = useRouter()
  const incoming = snapshot.requests.filter((item) => item.direction === 'incoming')
  const outgoing = snapshot.requests.filter((item) => item.direction === 'outgoing')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pendingTarget, setPendingTarget] = useState(null)

  async function search(event) {
    event.preventDefault()
    const term = query.trim()
    if (!term) return setResults([])
    setSearching(true)
    const { data } = await client.rpc('social_friend_search_v2', { search_term: term, result_limit: 30 })
    setResults(data || [])
    setSearching(false)
  }

  async function request(person) {
    setPendingTarget(person.id)
    await client.rpc('social_send_friend_request_v1', { target: person.id })
    setPendingTarget(null)
    router.refresh()
  }
  async function respond(person, response) {
    setPendingTarget(person.id)
    await client.rpc('social_respond_friend_request_v1', { target: person.id, response })
    setPendingTarget(null)
    router.refresh()
  }
  async function cancel(person) {
    if (pendingTarget) return
    setPendingTarget(person.id)
    const { error } = await client.rpc('social_cancel_friend_request_v1', { target: person.id })
    setPendingTarget(null)
    if (!error) router.refresh()
  }

  return <section className="figma-friends-add-view">
    <h1>Add Friends</h1>
    <form className="figma-friends-search" onSubmit={search}>
      <span aria-hidden="true">♧</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or @username" maxLength={60} />
      <button type="submit" disabled={searching} aria-label="Search for friends">↑</button>
    </form>

    {results.length ? <div className="figma-friends-search-results">{results.map((person) => <div key={person.id}><Avatar client={client} person={person} /><span><strong>{person.display_name || person.username}</strong>{person.username ? <small>@{person.username}</small> : null}{person.mutual_count ? <small>{person.mutual_count} mutual</small> : null}</span>{person.is_friend ? <button type="button" onClick={() => router.push('/matches?tab=messages')}>Message</button> : <button type="button" onClick={() => request(person)} disabled={pendingTarget === person.id}>＋</button>}</div>)}</div> : null}

    <article className="figma-friends-request-card">
      <small>Request</small>
      {incoming.length ? incoming.map((person) => <div className="figma-friends-request-row" key={`in:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button className="is-accept" type="button" onClick={() => respond(person, 'accept')} disabled={pendingTarget === person.id}>✓</button><button className="is-decline" type="button" onClick={() => respond(person, 'decline')} disabled={pendingTarget === person.id}>×</button></div></div>) : <p>No requests</p>}
      <hr />
      <small>Sent</small>
      {outgoing.length ? outgoing.map((person) => <div className="figma-friends-request-row" key={`out:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button type="button" onClick={() => cancel(person)} disabled={pendingTarget === person.id} aria-label={`Cancel friend request to ${person.display_name || person.username || 'Puddle person'}`}>−</button></div></div>) : <p>No sent requests</p>}
    </article>
  </section>
}

export function FigmaSocialHub({ initialSnapshot, initialTab = 'messages' }) {
  const client = createClient()
  const tab = initialTab === 'friends' ? 'add' : initialTab
  return <div className={`figma-friends-screen is-${tab}`}>
    <FriendsTabs tab={tab} />
    {tab === 'shared' ? <SharedView client={client} snapshot={initialSnapshot} /> : tab === 'add' ? <AddView client={client} snapshot={initialSnapshot} /> : <MessagesView client={client} snapshot={initialSnapshot} />}
  </div>
}
