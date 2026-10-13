"use client"
import friendsStyles from "@/components/friends.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhotoFrame } from '@/components/photo-frame'
import { SavedPlacePicker } from '@/components/saved-place-picker'
import { DismissibleDetails } from '@/components/dismissible-details'
import { RoutedSegment } from '@/components/routed-segment'
import { createClient } from '@/lib/supabase/client'
import { hydrateSocialLocationRows } from '@/lib/app/social-location-metadata-client'
import { lastInboxCursor } from '@/lib/app/social-inbox-cursor'
import { MOBILE_LAYOUT_QUERY } from '@/lib/ui/mobile-layout'
import { mergeById, sortConversations, conversationPreview, conversationList } from '@/lib/app/social-message-model'

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
  return <PhotoFrame as="span" src={url} alt="" className={scopedClasses(friendsStyles, "figma-friends-avatar")} unavailableText={initials(name)} loadingText="" />
}

function MessagesTabs() {
  return <RoutedSegment
    className={scopedClasses(friendsStyles, "figma-friends-tabs")}
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
const MESSAGE_PAGE_SIZE = 50

export function FigmaMessagesRealtime({ initialSnapshot, conversationId = null }) {
  const client = useMemo(() => createClient(), [])
  const router = useRouter()
  const [isMobile, setIsMobile] = useState(null)

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const mobileModePending = isMobile === null && !conversationId
  const selected = isMobile === true && !conversationId ? null : initialSnapshot.selectedConversation
  const isConversationOpen = Boolean(selected) && !mobileModePending
  const selectedId = selected?.conversation_id || null
  const placeMenuRef = useRef(null)
  const messageScrollRef = useRef(null)
  const [conversations, setConversations] = useState(() => conversationList(initialSnapshot, selected))
  const [conversationsHasMore, setConversationsHasMore] = useState(Boolean(initialSnapshot.conversationsHasMore))
  const inboxCursorRef = useRef(lastInboxCursor(initialSnapshot.conversations))
  const [friends, setFriends] = useState(initialSnapshot.friends || [])
  const [friendsHasMore, setFriendsHasMore] = useState(Boolean(initialSnapshot.friendsHasMore))
  const [messages, setMessages] = useState(initialSnapshot.messages || [])
  const [messagesLoadedForId, setMessagesLoadedForId] = useState(() => conversationId ? selectedId : null)
  const [messagesLoadFailedForId, setMessagesLoadFailedForId] = useState(null)
  const [messagesHasMore, setMessagesHasMore] = useState(Boolean(initialSnapshot.messagesHasMore))
  const [placePickerOpen, setPlacePickerOpen] = useState(false)
  // Drafts belong to a conversation, not to the currently displayed pane.
  // Keep them in memory only; Back and thread switches must not erase them.
  const [drafts, setDrafts] = useState({})
  const draft = drafts[selectedId] || ''
  const [busy, setBusy] = useState(false)
  const [paging, setPaging] = useState(false)
  const [openingFriendId, setOpeningFriendId] = useState(null)
  const [openingConversationId, setOpeningConversationId] = useState(null)
  const [navigationPending, setNavigationPending] = useState(false)
  const [notice, setNotice] = useState('')
  const messagesRefreshRef = useRef(null)
  const conversationsRefreshRef = useRef(null)
  const locationShareKeysRef = useRef(new Map())
  const messageScrollAnchorRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const renderedSelectedIdRef = useRef(null)
  const snapshotConversationIdRef = useRef(selectedId)
  const messageSnapshotConversationIdRef = useRef(selectedId)
  const conversationScopeRef = useRef(null)

  // Identity, rather than just an ID, also rejects an old A request after A → B → A.
  useLayoutEffect(() => {
    const scope = { id: selectedId }
    conversationScopeRef.current = scope
    return () => {
      if (conversationScopeRef.current === scope) conversationScopeRef.current = null
    }
  }, [selectedId])

  useEffect(() => {
    const nextFriends = initialSnapshot.friends || []
    const changedConversation = snapshotConversationIdRef.current !== selectedId
    snapshotConversationIdRef.current = selectedId
    if (changedConversation) {
      inboxCursorRef.current = lastInboxCursor(initialSnapshot.conversations)
      setConversationsHasMore(Boolean(initialSnapshot.conversationsHasMore))
    } else if (!inboxCursorRef.current) {
      inboxCursorRef.current = lastInboxCursor(initialSnapshot.conversations)
    }
    setFriends(nextFriends)
    setFriendsHasMore(Boolean(initialSnapshot.friendsHasMore))
    setConversations((current) => {
      if (changedConversation) return conversationList(initialSnapshot, selected)
      const real = current.filter((item) => !item.is_friend_placeholder)
      const incoming = initialSnapshot.conversations || []
      return conversationList({ ...initialSnapshot, friends: nextFriends }, selected, sortConversations(mergeById(real, incoming, 'conversation_id')))
    })
    if (!changedConversation) setConversationsHasMore((current) => current || Boolean(initialSnapshot.conversationsHasMore))
  }, [initialSnapshot.conversations, initialSnapshot.friends, initialSnapshot.friendsHasMore, initialSnapshot.conversationsHasMore, selectedId])

  useLayoutEffect(() => {
    const changedConversation = messageSnapshotConversationIdRef.current !== selectedId
    messageSnapshotConversationIdRef.current = selectedId
    setMessages((current) => changedConversation ? (initialSnapshot.messages || []) : mergeById(current, initialSnapshot.messages || []))
    if (changedConversation) {
      setMessagesHasMore(Boolean(initialSnapshot.messagesHasMore))
      setMessagesLoadedForId(conversationId ? selectedId : null)
      setMessagesLoadFailedForId(null)
      setNotice('')
      setBusy(false)
      setPaging(false)
    }
    if (conversationId && selectedId) setMessagesLoadedForId(selectedId)
  }, [conversationId, initialSnapshot.messages, initialSnapshot.messagesHasMore, selectedId])

  const latestMessageId = messages.length ? messages[messages.length - 1]?.id : null
  useLayoutEffect(() => {
    const node = messageScrollRef.current
    if (!node) return

    if (renderedSelectedIdRef.current !== selectedId) {
      renderedSelectedIdRef.current = selectedId
      messageScrollAnchorRef.current = null
      stickToBottomRef.current = true
      node.scrollTop = node.scrollHeight
      return
    }

    const anchor = messageScrollAnchorRef.current
    if (anchor) {
      node.scrollTop = anchor.scrollTop + (node.scrollHeight - anchor.scrollHeight)
      messageScrollAnchorRef.current = null
      return
    }

    if (!stickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [selectedId, latestMessageId, messages.length])

  useEffect(() => {
    setNavigationPending(false)
    setOpeningConversationId(null)
    setOpeningFriendId(null)
  }, [conversationId])

  async function markSelectedRead() {
    if (!selectedId) return
    const { error } = await client.rpc('social_mark_conversation_read_v1', { target: selectedId, last_message: null })
    if (error) throw error
  }

  async function refreshMessages() {
    const scope = conversationScopeRef.current
    const targetId = selectedId
    if (!targetId || scope?.id !== targetId) return false
    if (messagesRefreshRef.current?.scope === scope) return messagesRefreshRef.current.promise

    const request = { scope }
    request.promise = (async () => {
      try {
        const { data, error } = await client.rpc('social_messages_v2', {
          target: targetId,
          before_message_id: null,
          result_limit: MESSAGE_PAGE_SIZE
        })
        if (conversationScopeRef.current !== scope) return false
        if (!error && Array.isArray(data)) {
          const hydrated = await hydrateSocialLocationRows(data)
          if (conversationScopeRef.current !== scope) return false
          setMessages((current) => mergeById(current, hydrated))
          setMessagesHasMore((current) => current || data.length === MESSAGE_PAGE_SIZE)
          setMessagesLoadedForId(targetId)
          setMessagesLoadFailedForId(null)
          return true
        }
        if (error) throw error
        throw new Error('Message response was invalid.')
      } catch (cause) {
        console.warn('Could not refresh messages.', { message: cause?.message || 'unknown error' })
        if (conversationScopeRef.current === scope) {
          setMessagesLoadFailedForId(targetId)
          setNotice('Messages could not be refreshed.')
        }
      }
      return false
    })()
    messagesRefreshRef.current = request
    try {
      return await request.promise
    } finally {
      if (messagesRefreshRef.current === request) messagesRefreshRef.current = null
    }
  }

  async function refreshConversations() {
    const scope = conversationScopeRef.current
    if (!scope) return false
    if (conversationsRefreshRef.current?.scope === scope) return conversationsRefreshRef.current.promise
    const request = { scope }
    request.promise = (async () => {
      try {
        const { data, error } = await client.rpc('social_conversations_v2', {
          before_sort_at: null,
          before_conversation_id: null,
          result_limit: 30
        })
        if (conversationScopeRef.current !== scope) return false
        if (!error && Array.isArray(data)) {
          const hydrated = await hydrateSocialLocationRows(data, 'last_location_id')
          if (conversationScopeRef.current !== scope) return false
          setConversations((current) => {
            const real = current.filter((item) => !item.is_friend_placeholder)
            return conversationList({ ...initialSnapshot, friends }, selected, sortConversations(mergeById(real, hydrated, 'conversation_id')))
          })
          setConversationsHasMore((current) => current || data.length === 30)
          return true
        }
        if (error) throw error
        throw new Error('Conversation response was invalid.')
      } catch (cause) {
        console.warn('Could not refresh conversations.', { message: cause?.message || 'unknown error' })
        if (conversationScopeRef.current === scope) setNotice('Conversations could not be refreshed.')
      }
      return false
    })()
    conversationsRefreshRef.current = request
    try {
      return await request.promise
    } finally {
      if (conversationsRefreshRef.current === request) conversationsRefreshRef.current = null
    }
  }

  useEffect(() => {
    if (isMobile !== false || conversationId || !selectedId || messages.length) return
    void refreshMessages()
  }, [conversationId, isMobile, selectedId, messages.length])

  useEffect(() => {
    if (isMobile === null) return undefined

    function refreshOnReturn() {
      if (document.visibilityState === 'visible') void refreshConversations()
    }

    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [isMobile, selectedId])

  useEffect(() => {
    if (isMobile === null || !selectedId) return undefined
    let active = true

    async function initializeReadState() {
      if (!active) return
      try {
        await markSelectedRead()
        if (active) await refreshConversations()
      } catch (cause) {
        console.warn('Could not mark conversation read.', { message: cause?.message || 'unknown error' })
        if (active) setNotice('This conversation could not be updated.')
      }
    }
    initializeReadState()

    const channel = client
      .channel(`figma-messages-realtime-${initialSnapshot.self.id}-${selectedId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${selectedId}`
      }, async () => {
        if (!active) return
        await refreshMessages()
        if (!active) return
        try {
          await markSelectedRead()
          if (active) await refreshConversations()
        } catch (cause) {
          console.warn('Could not update conversation read state.', { message: cause?.message || 'unknown error' })
          if (active) setNotice('This conversation could not be updated.')
        }
      })
      .subscribe()

    return () => {
      active = false
      client.removeChannel(channel)
    }
  }, [client, initialSnapshot.self.id, isMobile, selectedId])

  useEffect(() => {
    if (isMobile === null) return undefined
    let active = true
    const channel = client
      .channel(`figma-inbox-${initialSnapshot.self.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${initialSnapshot.self.id}`
      }, async (payload) => {
        if (!active || !['message', 'share'].includes(payload.new?.kind)) return
        await refreshConversations()
      })
      .subscribe()
    return () => {
      active = false
      client.removeChannel(channel)
    }
  }, [client, initialSnapshot.self.id, isMobile, selectedId])

  async function openConversation(conversation) {
    if (!conversation || openingConversationId || openingFriendId) return
    if (conversation.conversation_id) {
      if (conversation.conversation_id === selectedId) return
      setOpeningConversationId(conversation.conversation_id)
      setNavigationPending(true)
      setNotice('')
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(conversation.conversation_id)}`)
      return
    }
    if (!conversation.friend_id) return
    setOpeningFriendId(conversation.friend_id)
    setNotice('')
    try {
      const { data, error } = await client.rpc('social_open_direct_conversation_v1', { target: conversation.friend_id })
      if (error || !data) {
        setNotice('Could not open that conversation.')
        return
      }
      setNavigationPending(true)
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    } catch {
      setNotice('Could not open that conversation.')
    } finally {
      setOpeningFriendId(null)
    }
  }

  async function loadOlderMessages() {
    if (!selectedId || !messages.length || paging || !messagesHasMore) return
    const scope = conversationScopeRef.current
    const targetId = selectedId
    const node = messageScrollRef.current
    const anchor = node ? { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight } : null
    setPaging(true)
    const oldest = messages[0]
    try {
      const { data, error } = await client.rpc('social_messages_v2', {
        target: targetId,
        before_message_id: oldest.id,
        result_limit: MESSAGE_PAGE_SIZE
      })
      if (conversationScopeRef.current !== scope) return
      if (!error && Array.isArray(data)) {
        const hydrated = await hydrateSocialLocationRows(data)
        if (conversationScopeRef.current !== scope) return
        if (hydrated.length && anchor) messageScrollAnchorRef.current = anchor
        setMessages((current) => mergeById(hydrated, current))
        setMessagesHasMore(data.length === MESSAGE_PAGE_SIZE)
      }
      if (error || !Array.isArray(data)) setNotice('Older messages could not be loaded.')
    } catch (cause) {
      console.warn('Could not load older messages.', { message: cause?.message || 'unknown error' })
      if (conversationScopeRef.current === scope) setNotice('Older messages could not be loaded.')
    } finally {
      if (conversationScopeRef.current === scope) setPaging(false)
    }
  }

  async function loadMoreConversations() {
    if (!conversationsHasMore || paging) return
    const scope = conversationScopeRef.current
    const cursor = inboxCursorRef.current
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
      if (error || !Array.isArray(data)) throw error || new Error('Conversation page was invalid.')
      const hydrated = await hydrateSocialLocationRows(data, 'last_location_id')
      if (conversationScopeRef.current !== scope) return
      setConversations((current) => {
        const placeholders = current.filter((item) => item.is_friend_placeholder)
        const real = current.filter((item) => !item.is_friend_placeholder)
        const merged = sortConversations(mergeById(real, hydrated, 'conversation_id'))
        const friendIds = new Set(merged.map((item) => item.friend_id).filter(Boolean))
        return [...merged, ...placeholders.filter((item) => !friendIds.has(item.friend_id))]
      })
      if (data.length) inboxCursorRef.current = lastInboxCursor(data)
      setConversationsHasMore(data.length === 30)
    } catch (cause) {
      console.warn('Could not load more conversations.', { message: cause?.message || 'unknown error' })
      if (conversationScopeRef.current === scope) setNotice('More conversations could not be loaded.')
    } finally {
      if (conversationScopeRef.current === scope) setPaging(false)
    }
  }

  async function loadMoreFriends() {
    if (!friendsHasMore || paging) return
    const scope = conversationScopeRef.current
    const cursor = friends[friends.length - 1]
    if (!cursor) {
      setFriendsHasMore(false)
      return
    }
    setPaging(true)
    try {
      const { data, error } = await client.rpc('social_friends_v2', {
        before_name: cursor.sort_name || String(cursor.display_name || cursor.username || '').toLowerCase(),
        before_id: cursor.id,
        result_limit: 100
      })
      if (error || !Array.isArray(data)) throw error || new Error('Friend page was invalid.')
      if (conversationScopeRef.current !== scope) return
      const nextFriends = mergeById(friends, data)
      setFriends(nextFriends)
      setFriendsHasMore(data.length === 100)
      setConversations((current) => conversationList({ ...initialSnapshot, friends: nextFriends }, selected, current))
    } catch (cause) {
      console.warn('Could not load more friends.', { message: cause?.message || 'unknown error' })
      if (conversationScopeRef.current === scope) setNotice('More friends could not be loaded.')
    } finally {
      if (conversationScopeRef.current === scope) setPaging(false)
    }
  }

  async function send(event) {
    event.preventDefault()
    const submittedDraft = draft
    const body = draft.trim()
    if (!body || !selectedId || busy) return
    const scope = conversationScopeRef.current
    setBusy(true)
    setNotice('')
    try {
      const { data, error } = await client.rpc('social_send_message_v1', { target: selectedId, message_body: body })
      if (error || !data) throw error || new Error('Message was not accepted.')
      setDrafts((current) => {
        if (current[selectedId] !== submittedDraft) return current
        const next = { ...current }
        delete next[selectedId]
        return next
      })
      if (conversationScopeRef.current !== scope) return
      stickToBottomRef.current = true
    } catch (cause) {
      console.warn('Could not send message.', { message: cause?.message || 'unknown error' })
      if (conversationScopeRef.current !== scope) return
      setNotice('Could not send that message.')
      setBusy(false)
      return
    }
    try {
      await reconcileSentMessage(scope)
    } finally {
      if (conversationScopeRef.current === scope) setBusy(false)
    }
  }

  async function reconcileSentMessage(scope) {
    if (conversationScopeRef.current !== scope) return
    let messagesUpdated = false
    let readUpdated = true
    let conversationsUpdated = false
    try {
      messagesUpdated = await refreshMessages()
    } catch (cause) {
      console.warn('Could not refresh sent message.', { message: cause?.message || 'unknown error' })
    }
    if (conversationScopeRef.current !== scope) return
    try {
      await markSelectedRead()
    } catch (cause) {
      readUpdated = false
      console.warn('Could not update sent-message read state.', { message: cause?.message || 'unknown error' })
    }
    if (conversationScopeRef.current !== scope) return
    try {
      conversationsUpdated = await refreshConversations()
    } catch (cause) {
      console.warn('Could not refresh conversation after sending.', { message: cause?.message || 'unknown error' })
    }
    if (conversationScopeRef.current === scope && (!messagesUpdated || !conversationsUpdated || !readUpdated)) {
      setNotice('Sent, but the conversation could not be fully refreshed. Reopen it to see the latest state.')
    }
  }

  async function sendLocation(locationId) {
    if (!selectedId || busy) return
    const scope = conversationScopeRef.current
    const requestId = `${selectedId}:${locationId}`
    const requestKey = locationShareKeysRef.current.get(requestId) || crypto.randomUUID()
    locationShareKeysRef.current.set(requestId, requestKey)
    setBusy(true)
    setNotice('')
    try {
      const { data, error } = await client.rpc('social_send_location_message_v1', {
        target: selectedId,
        target_location: locationId,
        request_key: requestKey
      })
      if (error || !data) throw error || new Error('Place was not attached.')
      locationShareKeysRef.current.delete(requestId)
      if (conversationScopeRef.current !== scope) return
      placeMenuRef.current?.removeAttribute('open')
      stickToBottomRef.current = true
    } catch (cause) {
      console.warn('Could not attach place.', { message: cause?.message || 'unknown error' })
      if (conversationScopeRef.current !== scope) return
      setNotice('Could not attach that place.')
      setBusy(false)
      return
    }
    try {
      await reconcileSentMessage(scope)
    } finally {
      if (conversationScopeRef.current === scope) setBusy(false)
    }
  }

  function handleMessageScroll(event) {
    const node = event.currentTarget
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = remaining <= node.clientHeight * .15
  }

  function handleBackNavigation(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    setNavigationPending(true)
  }

  return <div className={scopedClasses(friendsStyles, `figma-friends-screen is-messages${isConversationOpen ? ' is-conversation-open' : ''}${mobileModePending ? ' is-mobile-mode-pending' : ''}`)} aria-busy={navigationPending || undefined}>
    <MessagesTabs />
    {navigationPending ? <div className={scopedClasses(friendsStyles, "figma-messages-navigation-status")} role="status" aria-label="Loading conversation">Loading conversation...</div> : null}
    <div className={scopedClasses(friendsStyles, "figma-friends-message-layout")}>
      <aside className={scopedClasses(friendsStyles, "figma-friends-conversations")} aria-label="Conversations">
        {!selected && notice ? <p role="status">{notice}</p> : null}
        {conversations.length ? conversations.map((conversation) => <button
          className={scopedClasses(friendsStyles, selectedId && selectedId === conversation.conversation_id ? 'is-active' : '')}
          type="button"
          onClick={() => openConversation(conversation)}
          disabled={Boolean(openingConversationId || openingFriendId) || openingFriendId === conversation.friend_id}
          key={conversation.conversation_id || `friend:${conversation.friend_id}`}
        >
          <Avatar client={client} person={{ display_name: conversation.display_name, avatar_path: conversation.avatar_path }} />
          <span><strong>{conversation.display_name || conversation.username || 'Friend'}</strong><small>{conversationPreview(conversation, openingFriendId)}</small></span>
          {conversation.unread_count > 0 ? <b>{conversation.unread_count}</b> : null}
        </button>) : <div className={scopedClasses(friendsStyles, "figma-friends-conversation-empty")}>No conversations yet</div>}
        {conversationsHasMore ? <button type="button" onClick={loadMoreConversations} disabled={paging}>Load more conversations</button> : null}
        {friendsHasMore ? <button type="button" onClick={loadMoreFriends} disabled={paging}>Load more friends</button> : null}
      </aside>

      <section className={scopedClasses(friendsStyles, "figma-friends-chat")}>
        {selected ? <>
          <header>
            {/* A route link keeps the mobile back affordance a real navigation target while the
                conversation remains in the shared Messages route. */}
            <Link
              href="/matches?tab=messages"
              replace
              scroll={false}
              onClick={handleBackNavigation}
              className={scopedClasses(friendsStyles, "figma-friends-chat-back")}
              aria-label="Back to conversations"
            >‹</Link>
            <Avatar client={client} person={{ display_name: selected.display_name, avatar_path: selected.avatar_path }} />
            <span><strong>{selected.display_name || selected.username || 'Friend'}</strong>{selected.username ? <small>@{selected.username}</small> : null}</span>
          </header>
          <div className={scopedClasses(friendsStyles, "figma-friends-messages")} ref={messageScrollRef} onScroll={handleMessageScroll} aria-live="polite">
            {messagesHasMore ? <button type="button" onClick={loadOlderMessages} disabled={paging}>Load older messages</button> : null}
            {messages.length ? messages.map((item) => {
              const mine = item.sender_id === initialSnapshot.self.id
              return <div className={scopedClasses(friendsStyles, `figma-friends-message${mine ? ' is-mine' : ''}`)} key={item.id}>
                {!mine ? <Avatar client={client} person={item} /> : null}
                <div>{item.message_type === 'location' && item.location_slug ? <Link className={scopedClasses(friendsStyles, "figma-friends-location-message")} href={`/plans/${item.location_slug}`}><strong>{item.location_name || 'Shared place'}</strong><small>{item.location_city || 'Open place'}</small></Link> : <p>{item.body}</p>}</div>
              </div>
            }) : <div className={scopedClasses(friendsStyles, "figma-friends-chat-empty")} role="status">{messagesLoadFailedForId === selectedId ? <><span>Messages could not be loaded.</span><button type="button" onClick={refreshMessages}>Try again</button></> : messagesLoadedForId === selectedId ? 'Say hello' : 'Loading messages…'}</div>}
          </div>
          {notice ? <p className={scopedClasses(friendsStyles, "figma-friends-chat-notice")} role="status">{notice}</p> : null}
          <form className={scopedClasses(friendsStyles, "figma-friends-composer puddle-text-composer")} onSubmit={send}>
            <DismissibleDetails
              className={scopedClasses(friendsStyles, "figma-friends-composer-menu is-attachment")}
              ref={placeMenuRef}
              onOpen={() => setPlacePickerOpen(true)}
            >
              <summary aria-label="Add a place" title="Add a place">+</summary>
              <div className={scopedClasses(friendsStyles, "figma-message-place-picker")}><strong>Share a saved place</strong>{placePickerOpen ? <SavedPlacePicker disabled={busy} onSelect={location => sendLocation(location.id)} autoFocus /> : null}</div>
            </DismissibleDetails>
            <DismissibleDetails className={scopedClasses(friendsStyles, "figma-friends-composer-menu is-more")}>
              <summary aria-label="More message options">○</summary>
              <div><Link href="/matches?tab=shared">View shared puddles</Link><Link href="/plans">Open Saved</Link></div>
            </DismissibleDetails>
            <input value={draft} onChange={(event) => {
              const value = event.target.value
              setDrafts((current) => ({ ...current, [selectedId]: value }))
            }} placeholder="Text Message" aria-label="Message" maxLength={5000} />
            <button className={scopedClasses(friendsStyles, "is-send puddle-send-action")} type="submit" disabled={!draft.trim() || busy} aria-label="Send message">↑</button>
          </form>
        </> : <div className={scopedClasses(friendsStyles, "figma-friends-chat-empty")}>Select a conversation</div>}
      </section>
    </div>
  </div>
}
