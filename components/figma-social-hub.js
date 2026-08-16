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

function MessagesView({ client, snapshot }) {
  const router = useRouter()
  const [messages, setMessages] = useState(snapshot.messages || [])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = snapshot.selectedConversation

  useEffect(() => setMessages(snapshot.messages || []), [snapshot.messages, selected?.conversation_id])

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selected || busy) return
    setBusy(true)
    const { error } = await client.rpc('social_send_message_v1', { target: selected.conversation_id, message_body: body })
    if (!error) {
      setDraft('')
      const { data } = await client.rpc('social_messages_v1', { target: selected.conversation_id })
      if (data) setMessages(data)
    }
    setBusy(false)
  }

  return <div className="figma-friends-message-layout">
    <aside className="figma-friends-conversations" aria-label="Conversations">
      {snapshot.conversations.length ? snapshot.conversations.map((conversation) => <button
        className={selected?.conversation_id === conversation.conversation_id ? 'is-active' : ''}
        type="button"
        onClick={() => router.push(`/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}`)}
        key={conversation.conversation_id}
      >
        <Avatar client={client} person={{ display_name: conversation.display_name, avatar_path: conversation.avatar_path }} />
        <span><strong>{conversation.display_name || conversation.username || 'Friend'}</strong><small>{conversation.last_message || 'Start a conversation'}</small></span>
        {conversation.unread_count > 0 ? <b>{conversation.unread_count}</b> : null}
      </button>) : <div className="figma-friends-conversation-empty">No conversations yet</div>}
    </aside>

    <section className="figma-friends-chat">
      {selected ? <>
        <header><Avatar client={client} person={{ display_name: selected.display_name, avatar_path: selected.avatar_path }} /><span><strong>{selected.display_name || selected.username || 'Friend'}</strong>{selected.username ? <small>@{selected.username}</small> : null}</span></header>
        <div className="figma-friends-messages" aria-live="polite">
          {messages.length ? messages.map((message) => {
            const mine = message.sender_id === snapshot.self.id
            return <div className={`figma-friends-message${mine ? ' is-mine' : ''}`} key={message.id}>
              {!mine ? <Avatar client={client} person={message} /> : null}
              <div>{message.message_type === 'location' && message.location_slug ? <Link href={`/plans/${message.location_slug}`}>{message.location_name || 'Shared place'}</Link> : <p>{message.body}</p>}</div>
            </div>
          }) : <div className="figma-friends-chat-empty">Say hello</div>}
        </div>
        <form className="figma-friends-composer" onSubmit={send}>
          <button type="button" aria-label="Add attachment">+</button>
          <button type="button" aria-label="More message options">○</button>
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
      {snapshot.shared.length ? snapshot.shared.slice(0,2).flatMap((item) => [
        <article className="figma-friends-shared-place" key={`place:${item.share_id}`}>
          <Link className="figma-friends-shared-photo" href={item.location_slug ? `/plans/${item.location_slug}` : '/plans'} style={mediaUrl(client, item.location_cover_path) ? { backgroundImage: `url(${mediaUrl(client, item.location_cover_path)})` } : undefined} />
          <h2>{item.location_name || 'Shared puddle'}</h2>
          <small>{item.location_city || ''}</small>
          <span>{item.distance_label || ''}</span>
          <b>{item.direction === 'received' ? `Shared by ${item.friend_name || 'friend'}` : `Shared with ${item.friend_name || 'friend'}`}</b>
        </article>,
        <article className="figma-friends-shared-chat" key={`chat:${item.share_id}`}>
          <button type="button" onClick={() => router.push('/matches?tab=messages')}>Jump to chat</button>
        </article>
      ]) : <div className="figma-friends-shared-empty">No shared puddles yet.</div>}
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

  async function search(event) {
    event.preventDefault()
    const term = query.trim()
    if (!term) return setResults([])
    setSearching(true)
    const { data } = await client.rpc('social_friend_search_v1', { search_term: term })
    setResults(data || [])
    setSearching(false)
  }

  async function request(person) {
    await client.rpc('social_send_friend_request_v1', { target: person.id })
    router.refresh()
  }
  async function respond(person, response) {
    await client.rpc('social_respond_friend_request_v1', { target: person.id, response })
    router.refresh()
  }

  return <section className="figma-friends-add-view">
    <h1>Add Friends</h1>
    <form className="figma-friends-search" onSubmit={search}>
      <span aria-hidden="true">♧</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or @username" maxLength={60} />
      <button type="submit" disabled={searching} aria-label="Search for friends">↑</button>
    </form>

    {results.length ? <div className="figma-friends-search-results">{results.map((person) => <div key={person.id}><Avatar client={client} person={person} /><span><strong>{person.display_name || person.username}</strong>{person.username ? <small>@{person.username}</small> : null}</span>{person.is_friend ? <button type="button" onClick={() => router.push('/matches?tab=messages')}>Message</button> : <button type="button" onClick={() => request(person)}>＋</button>}</div>)}</div> : null}

    <article className="figma-friends-request-card">
      <small>Request</small>
      {incoming.length ? incoming.map((person) => <div className="figma-friends-request-row" key={`in:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button className="is-accept" type="button" onClick={() => respond(person, 'accept')}>✓</button><button className="is-decline" type="button" onClick={() => respond(person, 'decline')}>×</button></div></div>) : <p>No requests</p>}
      <hr />
      <small>Sent</small>
      {outgoing.length ? outgoing.map((person) => <div className="figma-friends-request-row" key={`out:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button type="button" disabled>−</button></div></div>) : <p>No sent requests</p>}
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
