"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
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

function Avatar({ client, person, className = '' }) {
  const path = person?.avatar_path || person?.friend_avatar_path || person?.sender_avatar_path
  const name = person?.display_name || person?.friend_name || person?.sender_name || 'Puddle person'
  const url = mediaUrl(client, path)
  return <PhotoFrame as="span" src={url} alt="" className={`figma-friends-avatar ${className}`} unavailableText={initials(name)} loadingText="" />
}

function FriendsTabs({ tab }) {
  return <RoutedSegment
    className="figma-friends-tabs"
    tone="green"
    activeValue={tab}
    ariaLabel="Friends sections"
    items={[
      { value: 'messages', label: 'Message', href: '/matches?tab=messages' },
      { value: 'shared', label: 'Shared', href: '/matches?tab=shared' },
      { value: 'add', label: 'Add', href: '/matches?tab=add' }
    ]}
  />
}

function SharedView({ client, snapshot }) {
  const router = useRouter()
  return <section className="figma-friends-shared-view">
    <h1>Shared puddles</h1>
    <div className="figma-friends-shared-grid">
      {snapshot.shared.length ? snapshot.shared.flatMap((item) => {
        const conversation = snapshot.conversations.find((candidate) => candidate.friend_id === item.friend_id)
        const chatHref = conversation ? `/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}` : '/matches?tab=messages'
        const placeHref = item.location_slug ? `/plans/${item.location_slug}` : '/plans'
        const placePhotoUrl = mediaUrl(client, item.location_cover_path)
        return [
          <article className="figma-friends-shared-place" key={`place:${item.share_id}`}>
            <PhotoFrame as={Link} className="figma-friends-shared-photo" href={placeHref} src={placePhotoUrl} alt={`${item.location_name || 'Shared puddle'} photo`} aria-label={`Open ${item.location_name || 'shared puddle'}`} />
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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pendingTarget, setPendingTarget] = useState(null)
  const [hiddenOutgoing, setHiddenOutgoing] = useState(() => new Set())
  const [notice, setNotice] = useState('')

  async function search(event) {
    event.preventDefault()
    const term = query.trim()
    setNotice('')
    if (!term) return setResults([])
    setSearching(true)
    try {
      const { data, error } = await client.rpc('social_friend_search_v2', { search_term: term, result_limit: 30 })
      if (error) {
        setResults([])
        setNotice('Friend search could not be completed.')
        return
      }
      setResults(data || [])
    } catch (cause) {
      console.warn('Could not search for friends.', { message: cause?.message || 'unknown error' })
      setResults([])
      setNotice('Friend search could not be completed.')
    } finally {
      setSearching(false)
    }
  }

  async function request(person) {
    setPendingTarget(person.id)
    setNotice('')
    try {
      const { error } = await client.rpc('social_send_friend_request_v1', { target: person.id })
      if (error) {
        setNotice('Could not send that friend request.')
        return
      }
      setHiddenOutgoing((current) => {
        const next = new Set(current)
        next.delete(person.id)
        return next
      })
      router.refresh()
    } catch (cause) {
      console.warn('Could not send friend request.', { message: cause?.message || 'unknown error' })
      setNotice('Could not send that friend request.')
    } finally {
      setPendingTarget(null)
    }
  }

  async function respond(person, response) {
    setPendingTarget(person.id)
    setNotice('')
    try {
      const { error } = await client.rpc('social_respond_friend_request_v1', { target: person.id, response })
      if (error) {
        setNotice('Could not update that friend request.')
        return
      }
      router.refresh()
    } catch (cause) {
      console.warn('Could not update friend request.', { message: cause?.message || 'unknown error' })
      setNotice('Could not update that friend request.')
    } finally {
      setPendingTarget(null)
    }
  }

  async function cancel(person) {
    if (pendingTarget) return
    setPendingTarget(person.id)
    setNotice('')
    try {
      const { error } = await client.rpc('social_cancel_friend_request_v1', { target: person.id })
      if (error) {
        setNotice('Could not cancel that friend request.')
        return
      }
      setHiddenOutgoing((current) => new Set([...current, person.id]))
      router.refresh()
    } catch (cause) {
      console.warn('Could not cancel friend request.', { message: cause?.message || 'unknown error' })
      setNotice('Could not cancel that friend request.')
    } finally {
      setPendingTarget(null)
    }
  }

  const outgoing = snapshot.requests.filter((item) => item.direction === 'outgoing' && !hiddenOutgoing.has(item.id))

  return <section className="figma-friends-add-view">
    <h1>Add Friends</h1>
    <form className="figma-friends-search" onSubmit={search}>
      <span aria-hidden="true">&#x2667;</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or @username" aria-label="Search friends by name or username" maxLength={60} />
      <button type="submit" disabled={searching} aria-label="Search for friends">&#x2191;</button>
    </form>
    {notice ? <p className="figma-friends-chat-notice figma-friends-add-notice" role="alert">{notice}</p> : null}

    {results.length ? <div className="figma-friends-search-results">{results.map((person) => <div key={person.id}><Avatar client={client} person={person} /><span><strong>{person.display_name || person.username}</strong>{person.username ? <small>@{person.username}</small> : null}{person.mutual_count ? <small>{person.mutual_count} mutual</small> : null}</span>{person.is_friend ? <button type="button" onClick={() => router.push('/matches?tab=messages')}>Message</button> : <button type="button" onClick={() => request(person)} disabled={pendingTarget === person.id} aria-label={`Add ${person.display_name || person.username || 'friend'}`}>&#xFF0B;</button>}</div>)}</div> : null}

    <article className="figma-friends-request-card">
      <small>Request</small>
      {incoming.length ? incoming.map((person) => <div className="figma-friends-request-row" key={`in:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button className="is-accept" type="button" onClick={() => respond(person, 'accept')} disabled={pendingTarget === person.id} aria-label={`Accept friend request from ${person.display_name || person.username || 'friend'}`}>&#x2713;</button><button className="is-decline" type="button" onClick={() => respond(person, 'decline')} disabled={pendingTarget === person.id} aria-label={`Decline friend request from ${person.display_name || person.username || 'friend'}`}>&#x00D7;</button></div></div>) : <p>No requests</p>}
      <hr />
      <small>Sent</small>
      {outgoing.length ? outgoing.map((person) => <div className="figma-friends-request-row" key={`out:${person.id}`}><Avatar client={client} person={person} /><span><strong>{person.display_name || 'Puddle person'}</strong>{person.username ? <em>@{person.username}</em> : null}</span><div><button type="button" onClick={() => cancel(person)} disabled={pendingTarget === person.id} aria-label={`Cancel friend request to ${person.display_name || person.username || 'Puddle person'}`}>&#x2212;</button></div></div>) : <p>No sent requests</p>}
    </article>
  </section>
}

export function FigmaSocialHub({ initialSnapshot, initialTab = 'messages' }) {
  const client = useMemo(() => createClient(), [])
  const tab = initialTab === 'friends' ? 'add' : initialTab
  return <div className={`figma-friends-screen is-${tab}`}>
    <FriendsTabs tab={tab} />
    {tab === 'shared' ? <SharedView client={client} snapshot={initialSnapshot} /> : <AddView client={client} snapshot={initialSnapshot} />}
  </div>
}
