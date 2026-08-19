"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function publicMediaUrl(client, path) {
  if (!path) return null
  if (String(path).startsWith('/') || String(path).startsWith('http')) return path
  return client.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function Avatar({ client, person, size = 'normal' }) {
  const url = publicMediaUrl(client, person?.avatar_path || person?.sender_avatar_path || person?.friend_avatar_path)
  const name = person?.display_name || person?.sender_name || person?.friend_name || 'Puddle person'
  return <span className={`social-avatar is-${size}`} style={url ? { backgroundImage: `url(${url})` } : undefined}>{url ? null : initials(name)}</span>
}

function RelativeTime({ value }) {
  if (!value) return null
  const date = new Date(value)
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
  const label = seconds < 60 ? 'now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  return <time dateTime={date.toISOString()}>{label}</time>
}

function PersonRow({ client, person, children, meta }) {
  return <div className="social-person-row">
    <Avatar client={client} person={person} />
    <div className="social-person-copy">
      <strong>{person.display_name || person.friend_name || 'Puddle person'}</strong>
      <span>{person.username || person.friend_username ? `@${person.username || person.friend_username}` : meta || person.city || ''}</span>
      {meta && (person.username || person.friend_username) ? <small>{meta}</small> : null}
    </div>
    <div className="social-row-actions">{children}</div>
  </div>
}

function FriendProfileSheet({ client, friend, onClose, onMessage }) {
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    client.rpc('shared_places_with_friend_v1', { target_friend: friend.id }).then(({ data, error }) => {
      if (!active) return
      if (error) onMessage(error.message || 'Could not load shared places.')
      setPlaces(data || [])
      setLoading(false)
    })
    return () => { active = false }
  }, [client, friend.id, onMessage])

  return <div className="social-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="social-profile-sheet" role="dialog" aria-modal="true" aria-label={`${friend.display_name || 'Friend'} profile`}>
      <button className="social-sheet-close" type="button" onClick={onClose} aria-label="Close">×</button>
      <div className="social-profile-hero">
        <Avatar client={client} person={friend} size="large" />
        <div><h2>{friend.display_name || 'Puddle person'}</h2>{friend.username ? <p>@{friend.username}</p> : null}{friend.city ? <span>{friend.city}</span> : null}</div>
      </div>
      {friend.bio ? <p className="social-profile-bio">{friend.bio}</p> : null}
      <div className="social-sheet-section-heading"><h3>Places in common</h3><span>{places.length}</span></div>
      {loading ? <p className="social-muted">Loading…</p> : places.length ? <div className="social-common-grid">{places.map((place) => {
        const cover = publicMediaUrl(client, place.cover_path)
        return <Link href={`/places/${place.slug}`} className="social-common-card" key={place.location_id}>
          <span style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
          <div><strong>{place.name}</strong><small>{place.city || String(place.category || '').replaceAll('_', ' ')}</small></div>
        </Link>
      })}</div> : <p className="social-muted">No shared saved places yet.</p>}
    </section>
  </div>
}

function FriendsTab({ client, snapshot, onChanged, onOpenConversation, onMessage }) {
  const incoming = snapshot.requests.filter((item) => item.direction === 'incoming')
  const outgoing = snapshot.requests.filter((item) => item.direction === 'outgoing')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [profile, setProfile] = useState(null)

  async function search(event) {
    event.preventDefault()
    const term = query.trim()
    if (!term) return setResults([])
    setSearching(true)
    const { data, error } = await client.rpc('social_friend_search_v2', { search_term: term })
    setSearching(false)
    if (error) return onMessage(error.message || 'Search failed.')
    setResults(data || [])
  }

  async function request(person) {
    const { error } = await client.rpc('social_send_friend_request_v1', { target: person.id })
    if (error) return onMessage(error.message || 'Could not send friend request.')
    onMessage('Friend request sent.')
    setResults((current) => current.map((item) => item.id === person.id ? { ...item, request_state: 'pending', request_direction: 'outgoing' } : item))
    onChanged()
  }

  async function respond(person, response) {
    const { error } = await client.rpc('social_respond_friend_request_v1', { target: person.id, response })
    if (error) return onMessage(error.message || 'Could not update that request.')
    onChanged()
  }

  async function remove(person) {
    if (!window.confirm(`Remove ${person.display_name || 'this person'} from your friends?`)) return
    const { error } = await client.rpc('social_remove_friend_v1', { target: person.id })
    if (error) return onMessage(error.message || 'Could not remove friend.')
    onChanged()
  }

  async function block(person) {
    if (!window.confirm(`Block ${person.display_name || 'this person'}?`)) return
    const { error } = await client.rpc('social_block_profile_v1', { target: person.id })
    if (error) return onMessage(error.message || 'Could not block this person.')
    onChanged()
  }

  return <div className="social-tab-body">
    <section className="social-search-card">
      <div><span className="social-kicker">Find people</span><h2>Add friends</h2></div>
      <form onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or @username" maxLength={60} /><button type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>
      {results.length ? <div className="social-search-results">{results.map((person) => <PersonRow client={client} person={person} meta={person.mutual_count ? `${person.mutual_count} mutual` : undefined} key={person.id}>
        {person.is_friend ? <button type="button" onClick={() => onOpenConversation(person.id)}>Message</button>
          : person.request_state === 'pending' && person.request_direction === 'incoming' ? <><button className="is-dark" type="button" onClick={() => respond(person, 'accept')}>Accept</button><button type="button" onClick={() => respond(person, 'decline')}>Decline</button></>
            : person.request_state === 'pending' ? <span className="social-state">Requested</span>
              : <button className="is-dark" type="button" onClick={() => request(person)}>Add</button>}
      </PersonRow>)}</div> : null}
    </section>

    {incoming.length ? <section className="social-section"><div className="social-section-heading"><h2>Requests</h2><span>{incoming.length}</span></div>{incoming.map((person) => <PersonRow client={client} person={person} key={`in:${person.id}`}><button className="is-dark" type="button" onClick={() => respond(person, 'accept')}>Accept</button><button type="button" onClick={() => respond(person, 'decline')}>Decline</button></PersonRow>)}</section> : null}

    <section className="social-section">
      <div className="social-section-heading"><h2>Friends</h2><span>{snapshot.friends.length}</span></div>
      {snapshot.friends.length ? snapshot.friends.map((friend) => <PersonRow client={client} person={friend} meta={`${friend.places_in_common || 0} places in common`} key={friend.id}>
        <button className="is-dark" type="button" onClick={() => onOpenConversation(friend.id)}>Message</button>
        <button type="button" onClick={() => setProfile(friend)}>View</button>
        <details className="social-row-menu"><summary aria-label="Friend options">•••</summary><div><button type="button" onClick={() => remove(friend)}>Remove friend</button><button type="button" onClick={() => block(friend)}>Block</button></div></details>
      </PersonRow>) : <div className="social-empty"><strong>No friends yet</strong><p>Search by name or username to add someone.</p></div>}
      {outgoing.length ? <p className="social-muted">{outgoing.length} outgoing request{outgoing.length === 1 ? '' : 's'} pending.</p> : null}
    </section>
    {profile ? <FriendProfileSheet client={client} friend={profile} onClose={() => setProfile(null)} onMessage={onMessage} /> : null}
  </div>
}

function LocationMessage({ client, message }) {
  const cover = publicMediaUrl(client, message.location_cover_path)
  return <div className="social-location-message">
    <span className="social-location-message-photo" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
    <div><small>Place</small><strong>{message.location_name || 'Shared place'}</strong>{message.location_city ? <span>{message.location_city}</span> : null}</div>
    {message.location_slug ? <Link href={`/places/${message.location_slug}`}>View</Link> : null}
  </div>
}

function MessagesTab({ client, snapshot, onChanged, onMessage }) {
  const router = useRouter()
  const [messages, setMessages] = useState(snapshot.messages || [])
  const [draft, setDraft] = useState('')
  const selected = snapshot.selectedConversation

  useEffect(() => { setMessages(snapshot.messages || []) }, [snapshot.messages, selected?.conversation_id])

  async function refreshMessages() {
    if (!selected) return
    const { data } = await client.rpc('social_messages_v2', { target: selected.conversation_id })
    if (data) {
      setMessages(data)
      const last = data[data.length - 1]
      if (last) client.rpc('social_mark_conversation_read_v1', { target: selected.conversation_id, last_message: last.id })
    }
  }

  useEffect(() => {
    if (!selected) return undefined
    refreshMessages()
    const channel = client.channel(`social-conversation-${selected.conversation_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selected.conversation_id}` }, refreshMessages)
      .subscribe()
    return () => { client.removeChannel(channel) }
  }, [client, selected?.conversation_id])

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selected) return
    setDraft('')
    const { error } = await client.rpc('social_send_message_v1', { target: selected.conversation_id, message_body: body })
    if (error) {
      setDraft(body)
      return onMessage(error.message || 'Could not send message.')
    }
    await refreshMessages()
    onChanged(false)
  }

  function selectConversation(id) {
    router.push(`/matches?tab=messages&conversation=${encodeURIComponent(id)}`)
  }

  return <div className="social-messages-layout">
    <aside className="social-conversation-list">
      <div className="social-section-heading"><h2>Messages</h2><span>{snapshot.conversations.length}</span></div>
      {snapshot.conversations.length ? snapshot.conversations.map((conversation) => <button className={selected?.conversation_id === conversation.conversation_id ? 'is-active' : ''} type="button" onClick={() => selectConversation(conversation.conversation_id)} key={conversation.conversation_id}>
        <Avatar client={client} person={{ display_name: conversation.display_name, avatar_path: conversation.avatar_path }} />
        <span><strong>{conversation.display_name || conversation.username || 'Friend'}</strong><small>{conversation.last_message || 'Start a conversation'}</small></span>
        <span className="social-conversation-meta">{conversation.unread_count > 0 ? <b>{conversation.unread_count}</b> : <RelativeTime value={conversation.last_message_at} />}</span>
      </button>) : <div className="social-empty compact"><strong>No conversations yet</strong><p>Open a friend and send a message.</p></div>}
    </aside>

    <section className="social-chat-panel">
      {selected ? <>
        <header className="social-chat-header"><Avatar client={client} person={{ display_name: selected.display_name, avatar_path: selected.avatar_path }} /><div><strong>{selected.display_name || selected.username || 'Friend'}</strong>{selected.username ? <span>@{selected.username}</span> : null}</div></header>
        <div className="social-message-scroll" aria-live="polite">{messages.length ? messages.map((message) => {
          const mine = message.sender_id === snapshot.self.id
          return <div className={`social-message ${mine ? 'is-mine' : ''}`} key={message.id}>
            {!mine ? <Avatar client={client} person={{ display_name: message.sender_name, avatar_path: message.sender_avatar_path }} size="small" /> : null}
            <div className="social-message-bubble">
              {message.message_type === 'location' ? <LocationMessage client={client} message={message} /> : <p>{message.body}</p>}
              {message.message_type === 'location' && message.body && !/^Shared\s/.test(message.body) ? <p className="social-share-note">{message.body}</p> : null}
              <small><RelativeTime value={message.created_at} />{message.edited_at ? ' · edited' : ''}</small>
            </div>
          </div>
        }) : <div className="social-empty"><strong>Say hello</strong><p>Your conversation starts here.</p></div>}</div>
        <form className="social-message-composer" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message…" maxLength={5000} /><button className="is-dark" type="submit" disabled={!draft.trim()}>Send</button></form>
      </> : <div className="social-chat-placeholder"><strong>Select a conversation</strong><p>Choose a friend from the left to start talking.</p></div>}
    </section>
  </div>
}

function SharedTab({ client, snapshot, onOpenConversation }) {
  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of snapshot.shared) {
      const list = map.get(item.friend_id) || []
      list.push(item)
      map.set(item.friend_id, list)
    }
    return [...map.entries()]
  }, [snapshot.shared])

  return <div className="social-tab-body">
    <section className="social-section">
      <div className="social-section-heading"><h2>Shared places</h2><span>{snapshot.shared.length}</span></div>
      {snapshot.shared.length ? <div className="social-shared-grid">{snapshot.shared.map((item) => {
        const cover = publicMediaUrl(client, item.location_cover_path)
        return <article className="social-shared-card" key={item.share_id}>
          <Link href={`/places/${item.location_slug}`} className="social-shared-photo" style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
          <div><small>{item.direction === 'received' ? `${item.friend_name || 'A friend'} sent this` : `Sent to ${item.friend_name || 'a friend'}`}</small><h3><Link href={`/places/${item.location_slug}`}>{item.location_name}</Link></h3>{item.location_city ? <span>{item.location_city}</span> : null}{item.note ? <p>{item.note}</p> : null}</div>
          <button type="button" onClick={() => onOpenConversation(item.friend_id)}>Message</button>
        </article>
      })}</div> : <div className="social-empty"><strong>Nothing shared yet</strong><p>Use Send to on a place to share it with a friend.</p></div>}
    </section>

    {grouped.length ? <section className="social-section"><div className="social-section-heading"><h2>People you share with</h2></div>{grouped.slice(0, 8).map(([friendId, items]) => <PersonRow client={client} person={items[0]} meta={`${items.length} shared place${items.length === 1 ? '' : 's'}`} key={friendId}><button type="button" onClick={() => onOpenConversation(friendId)}>Message</button></PersonRow>)}</section> : null}
  </div>
}

export function SocialHub({ initialSnapshot, initialTab = 'friends' }) {
  const router = useRouter()
  const client = useMemo(() => createClient(), [])
  const [tab, setTab] = useState(['friends','messages','shared'].includes(initialTab) ? initialTab : 'friends')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 2800)
    return () => window.clearTimeout(timer)
  }, [message])

  function changed(refresh = true) {
    if (refresh) router.refresh()
  }

  async function openConversation(friendId) {
    const { data, error } = await client.rpc('social_open_direct_conversation_v1', { target: friendId })
    if (error || !data) return setMessage(error?.message || 'Could not open conversation.')
    setTab('messages')
    router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    router.refresh()
  }

  function chooseTab(next) {
    setTab(next)
    const params = new URLSearchParams()
    params.set('tab', next)
    if (next === 'messages' && initialSnapshot.selectedConversation?.conversation_id) params.set('conversation', initialSnapshot.selectedConversation.conversation_id)
    router.replace(`/matches?${params.toString()}`)
  }

  return <div className="social-hub">
    <header className="social-hub-header">
      <div><span className="social-kicker">Puddle social</span><h1>Friends</h1><p>People, conversations, and places you have in common.</p></div>
    </header>
    <nav className="social-tabs" aria-label="Friends sections">
      {['friends','messages','shared'].map((value) => <button className={tab === value ? 'is-active' : ''} type="button" onClick={() => chooseTab(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </nav>
    {message ? <div className="social-toast" role="status">{message}</div> : null}
    {tab === 'friends' ? <FriendsTab client={client} snapshot={initialSnapshot} onChanged={changed} onOpenConversation={openConversation} onMessage={setMessage} /> : null}
    {tab === 'messages' ? <MessagesTab client={client} snapshot={initialSnapshot} onChanged={changed} onMessage={setMessage} /> : null}
    {tab === 'shared' ? <SharedTab client={client} snapshot={initialSnapshot} onOpenConversation={openConversation} /> : null}
  </div>
}
