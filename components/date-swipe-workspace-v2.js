"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MinimalSwipeCard } from '@/components/minimal-swipe-card'
import { SwipeActionDock } from '@/components/swipe-action-dock'
import { csrfFetch } from '@/lib/security/csrf-client'
import { prefetchStaticMedia } from '@/lib/app/use-static-media-resolution'

const ACTION_BATCH_DELAY_MS = 350
const ACTION_BATCH_SIZE = 20

function queryString(filters) {
  const params = new URLSearchParams({ kind: 'place', date: 'any' })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== false && value !== null && value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

function daypart() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 16) return 'afternoon'
  if (hour >= 17 && hour <= 22) return 'evening'
  return 'late'
}

function FilterSheet({ filters, categories, onChange, onApply, onClose, loading }) {
  return (
    <div className="minimal-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="minimal-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-title">
        <header><h2 id="filter-title">Filters</h2><button type="button" onClick={onClose} aria-label="Close filters">×</button></header>
        <label>Search<input value={filters.q || ''} onChange={(event) => onChange('q', event.target.value)} placeholder="Coffee, park, museum…" /></label>
        <label>Category<select value={filters.category || ''} onChange={(event) => onChange('category', event.target.value)}><option value="">Any category</option>{categories.map((category) => <option value={category} key={category}>{String(category).replaceAll('_', ' ')}</option>)}</select></label>
        <label>Distance<select value={String(filters.distance || 10)} onChange={(event) => onChange('distance', Number(event.target.value))}>{[2, 5, 10, 25, 50, 100].map((value) => <option value={value} key={value}>{value} km</option>)}</select></label>
        <label>Price<select value={filters.price || 'any'} onChange={(event) => onChange('price', event.target.value)}><option value="any">Any price</option><option value="1">$</option><option value="2">$$</option><option value="3">$$$</option><option value="4">$$$$</option></select></label>
        <label className="minimal-filter-check"><input type="checkbox" checked={Boolean(filters.openNow)} onChange={(event) => onChange('openNow', event.target.checked)} /> Open now</label>
        <label className="minimal-filter-check"><input type="checkbox" checked={Boolean(filters.accessible)} onChange={(event) => onChange('accessible', event.target.checked)} /> Accessible</label>
        <button className="minimal-primary-button" type="button" onClick={onApply} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
      </section>
    </div>
  )
}

function InviteSheet({ busy, room, onCreate, onClose, onMessage }) {
  async function copy() {
    await navigator.clipboard.writeText(room.url)
    onMessage('Invite link copied.')
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Puddle invite', url: room.url })
      else await copy()
    } catch (error) {
      if (error?.name !== 'AbortError') onMessage('Could not share the invite.')
    }
  }

  return (
    <div className="minimal-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="minimal-invite-sheet" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <header><h2 id="invite-title">Invite others</h2><button type="button" onClick={onClose} aria-label="Close invite">×</button></header>
        {room ? <>
          <p>Your shared deck is ready.</p>
          <div className="minimal-invite-actions"><button type="button" onClick={copy}>Copy link</button><button type="button" onClick={share}>Share</button><a href={room.url}>Open room</a></div>
        </> : <div className="minimal-invite-choice">
          <button type="button" onClick={() => onCreate('date')} disabled={busy}><strong>One person</strong><span>Create a two-person deck</span></button>
          <button type="button" onClick={() => onCreate('hangout')} disabled={busy}><strong>A group</strong><span>Create a group deck</span></button>
        </div>}
      </section>
    </div>
  )
}

function EmptyDeck({ feed, onRefresh, onFilters }) {
  if (feed.emptyReason === 'location_required') return <div className="minimal-deck-complete">
    <h1>Choose your location</h1>
    <p>Puddle needs a city or your current location before it can find nearby places.</p>
    <div><Link className="minimal-primary-button" href="/account">Set location</Link></div>
  </div>

  if (feed.emptyReason === 'catalogue_sync_pending') return <div className="minimal-deck-complete">
    <h1>Places are being added nearby</h1>
    <p>{feed.centerLabel ? `Puddle has your location in ${feed.centerLabel}, but this area needs a catalogue refresh.` : 'This area needs a catalogue refresh.'}</p>
    <div><button className="minimal-primary-button" type="button" onClick={onRefresh}>Try again</button><Link href="/account">Edit location</Link></div>
  </div>

  if (feed.emptyReason === 'filters') return <div className="minimal-deck-complete">
    <h1>No places match these filters</h1>
    <div><button className="minimal-primary-button" type="button" onClick={onFilters}>Change filters</button><button type="button" onClick={onRefresh}>Try again</button></div>
  </div>

  return <div className="minimal-deck-complete">
    <h1>{feed.items.length ? 'Deck complete' : 'No places found'}</h1>
    <div><button className="minimal-primary-button" type="button" onClick={onRefresh}>Swipe again</button></div>
  </div>
}

export function DateSwipeWorkspaceV2({ initialFeed }) {
  const [feed, setFeed] = useState({ ...initialFeed, items: initialFeed.items.slice(0, 12) })
  const [filters, setFilters] = useState({ ...initialFeed.filters, kind: 'place', date: 'any', limit: 12 })
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState({})
  const [showFilters, setShowFilters] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(initialFeed.recycled ? 'Showing passed places again.' : '')
  const actionBuffer = useRef([])
  const actionSequence = useRef(0)
  const flushTimer = useRef(null)
  const inFlight = useRef(Promise.resolve())
  const pendingItems = useRef(new Set())
  const current = feed.items[index] || null
  const categories = useMemo(() => [...new Set([...(feed.categories || []), ...feed.items.map((item) => item.category).filter(Boolean)])].sort(), [feed])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 2400)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    const upcoming = feed.items.slice(index + 1, index + 4)
    if (!upcoming.length) return
    prefetchStaticMedia(upcoming, { limit: 3, concurrency: 3 }).catch(() => {})
  }, [feed.items, index])

  const flushActions = useCallback(({ keepalive = false } = {}) => {
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    if (!actionBuffer.current.length) return inFlight.current
    const entries = actionBuffer.current.splice(0, ACTION_BATCH_SIZE)
    const task = async () => {
      const response = await csrfFetch('/api/discovery/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: entries.map((entry) => entry.payload) }),
        keepalive
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not save those choices.')
      for (const entry of entries) entry.resolve(result)
      return result
    }
    inFlight.current = inFlight.current.catch(() => {}).then(task).catch((error) => {
      setMessage(error.message)
      for (const entry of entries) entry.resolve(null)
      return null
    }).finally(() => {
      for (const entry of entries) if (entry.itemKey) pendingItems.current.delete(entry.itemKey)
      if (actionBuffer.current.length) flushActions({ keepalive })
    })
    return inFlight.current
  }, [])

  const queueDiscoveryAction = useCallback((payload, itemKey) => {
    const sequence = actionSequence.current++
    return new Promise((resolve) => {
      actionBuffer.current.push({
        itemKey,
        resolve,
        payload: {
          ...payload,
          eventId: crypto.randomUUID(),
          sequence
        }
      })
      if (actionBuffer.current.length >= ACTION_BATCH_SIZE) flushActions()
      else if (!flushTimer.current) flushTimer.current = window.setTimeout(() => flushActions(), ACTION_BATCH_DELAY_MS)
    })
  }, [flushActions])

  const drainActions = useCallback(async () => {
    await flushActions()
    await inFlight.current.catch(() => {})
  }, [flushActions])

  useEffect(() => {
    const flushBeforeLeaving = () => { if (actionBuffer.current.length) flushActions({ keepalive: true }) }
    const visibility = () => { if (document.visibilityState === 'hidden') flushBeforeLeaving() }
    window.addEventListener('pagehide', flushBeforeLeaving)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', flushBeforeLeaving)
      document.removeEventListener('visibilitychange', visibility)
      if (flushTimer.current) window.clearTimeout(flushTimer.current)
    }
  }, [flushActions])

  useEffect(() => {
    function keyboard(event) {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!current || busy || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input,textarea,select,button')) return
      if (event.key === 'ArrowLeft') persistChoice('pass', current)
      if (event.key === 'ArrowRight') persistChoice('save', current)
      if (event.key.toLowerCase() === 'p') persistChoice('perfect', current)
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'u') undo()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value, kind: 'place', date: 'any', limit: 12 }))
  }

  function context(item) {
    return { mode: 'solo', category: item?.category || filters.category || null, mood: filters.q || null, price: filters.price || 'any', daypart: daypart(), source: 'swipe' }
  }

  async function refresh(nextFilters = filters) {
    setLoading(true)
    await drainActions()
    const normalized = { ...nextFilters, kind: 'place', date: 'any', limit: 12 }
    const response = await fetch(`/api/discovery?${queryString(normalized)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) return setMessage(result.error || 'Could not load a new deck.')
    setFeed({ ...result, items: (result.items || []).slice(0, 12) })
    setFilters({ ...result.filters, kind: 'place', date: 'any', limit: 12 })
    setIndex(0)
    setChoices({})
    setRoom(null)
    setShowFilters(false)
    setMessage(result.recycled ? 'Showing passed places again.' : '')
  }

  function persistChoice(action, item) {
    if (!item || busy || pendingItems.current.has(item.content_id)) return
    pendingItems.current.add(item.content_id)
    const persistedAction = action === 'pass' ? 'dismissed' : action === 'perfect' ? 'perfect' : 'saved'
    setChoices((currentChoices) => ({ ...currentChoices, [item.content_id]: { choice: action, note: '' } }))
    setIndex((currentIndex) => currentIndex + 1)
    queueDiscoveryAction({
      action: persistedAction,
      contentKind: 'place',
      contentId: item.content_id,
      requestId: feed.requestId,
      context: context(item),
      staticCatalogueEphemeral: Boolean(item.static_catalogue_ephemeral),
      staticRef: item.static_ref || undefined
    }, item.content_id)
  }

  function undo() {
    const previousIndex = Math.max(0, index - 1)
    const item = feed.items[previousIndex]
    if (!item || index === 0 || busy || pendingItems.current.has(`undo:${item.content_id}`)) return
    const previousChoice = choices[item.content_id]
    pendingItems.current.add(`undo:${item.content_id}`)
    setIndex(previousIndex)
    setChoices((currentChoices) => { const next = { ...currentChoices }; delete next[item.content_id]; return next })
    queueDiscoveryAction({
      action: 'undo',
      contentKind: 'place',
      contentId: item.content_id,
      requestId: feed.requestId,
      staticCatalogueEphemeral: Boolean(item.static_catalogue_ephemeral),
      staticRef: item.static_ref || undefined
    }, `undo:${item.content_id}`).then((result) => {
      if (result) return
      setIndex((currentIndex) => Math.max(currentIndex, previousIndex + 1))
      if (previousChoice) setChoices((currentChoices) => ({ ...currentChoices, [item.content_id]: previousChoice }))
    })
  }

  async function createSharedDeck(mode) {
    if (busy || feed.items.length < 2) return
    setBusy(true)
    await drainActions()
    const response = await csrfFetch('/api/date-match/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationIds: feed.items.map((item) => item.content_id),
        staticRefs: Object.fromEntries(feed.items.filter((item) => item.static_catalogue_ephemeral && item.static_ref).map((item) => [item.content_id, item.static_ref])),
        center: feed.center,
        mode,
        maxMembers: mode === 'hangout' ? 4 : 2,
        context: { mood: filters.q || null, category: filters.category || null, price: filters.price || 'any', daypart: daypart() },
        choices: Object.entries(choices).map(([locationId, value]) => ({ locationId, ...value }))
      })
    })
    const result = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) return setMessage(result.error || 'Could not create the shared deck.')
    setRoom(result)
  }

  const deckComplete = feed.items.length > 0 && !current

  return (
    <section className="minimal-swipe-workspace">
      <header className="minimal-swipe-toolbar">
        <span aria-live="polite">{message}</span>
        <button type="button" onClick={() => setShowFilters(true)} aria-label="Open filters">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
        </button>
      </header>

      {current ? <>
        <div className="minimal-card-stage"><MinimalSwipeCard item={current} onChoice={persistChoice} busy={busy} /></div>
        <SwipeActionDock
          onUndo={undo}
          onPass={() => persistChoice('pass', current)}
          onSave={() => persistChoice('save', current)}
          onPerfect={() => persistChoice('perfect', current)}
          canUndo={index > 0}
          busy={busy}
        />
        <div className="minimal-progress" aria-label={`${index + 1} of ${feed.items.length}`}><span style={{ width: `${Math.max(6, ((index + 1) / Math.max(1, feed.items.length)) * 100)}%` }} /></div>
      </> : deckComplete ? <div className="minimal-deck-complete">
        <h1>Deck complete</h1>
        <div><button className="minimal-primary-button" type="button" onClick={() => setShowInvite(true)}>Invite others</button><button type="button" onClick={() => refresh()}>Swipe again</button></div>
      </div> : <EmptyDeck feed={feed} onRefresh={() => refresh()} onFilters={() => setShowFilters(true)} />}

      {showFilters ? <FilterSheet filters={filters} categories={categories} onChange={updateFilter} onApply={() => refresh(filters)} onClose={() => setShowFilters(false)} loading={loading} /> : null}
      {showInvite ? <InviteSheet busy={busy} room={room} onCreate={createSharedDeck} onClose={() => { setShowInvite(false); setRoom(null) }} onMessage={setMessage} /> : null}
    </section>
  )
}
