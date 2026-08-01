"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { DateLocationCard } from '@/components/date-swipe-workspace'
import { SwipeActionDock } from '@/components/swipe-action-dock'
import { csrfFetch } from '@/lib/security/csrf-client'

const categoryLabels = {
  cafe: 'Coffee shop', restaurant: 'Restaurant', bar: 'Bar or lounge', park: 'Park or garden',
  museum: 'Museum', gallery: 'Gallery', attraction: 'Local attraction', activity_venue: 'Activity date',
  study_spot: 'Quiet hangout', scenic_spot: 'Scenic spot', nightlife: 'Nightlife', shop: 'Market or shop',
  community_space: 'Community spot', other: 'Local date idea'
}

function categoryLabel(category) {
  return categoryLabels[category] || String(category || 'Local date idea').replaceAll('_', ' ')
}

function queryString(filters) {
  const params = new URLSearchParams({ kind: 'place', date: 'any' })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== false && value !== null && value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern) } catch {}
}

function ChoiceNoteModal({ pending, busy, onCancel, onSubmit }) {
  const [note, setNote] = useState('')
  if (!pending) return null
  const perfect = pending.choice === 'perfect'

  return (
    <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <section className={`date-choice-sheet swipe-note-sheet ${perfect ? 'is-perfect' : ''}`} role="dialog" aria-modal="true" aria-labelledby="swipe-note-title">
        <div className="swipe-note-orbit" aria-hidden="true"><span>{perfect ? '★' : '♥'}</span><i /><i /></div>
        <span className="section-pill">{perfect ? 'Perfect Pick' : 'Save this place'}</span>
        <h2 id="swipe-note-title">{perfect ? 'This one feels special.' : 'Add it to your shortlist.'}</h2>
        <p>Add an optional private note about {pending.item.title}. It can be carried into a DateMatch invitation later.</p>
        <textarea autoFocus maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Great patio, close to both of us, worth trying Friday…" />
        <div className="swipe-note-meta"><small>{note.length}/280</small><small>Only you can see this until a mutual match.</small></div>
        <div className="date-choice-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Go back</button>
          <button className={perfect ? 'is-perfect' : ''} type="button" onClick={() => onSubmit(note)} disabled={busy}>{busy ? 'Saving…' : perfect ? 'Make it a Perfect Pick' : 'Save location'}</button>
        </div>
      </section>
    </div>
  )
}

function ShareRoomPanel({ room, onClose, onMessage }) {
  if (!room) return null

  async function copy() {
    await navigator.clipboard.writeText(room.url)
    onMessage('DateMatch invitation copied.')
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Puddle DateMatch', text: 'Choose date locations with me and see where we match.', url: room.url })
      else await copy()
    } catch (error) {
      if (error?.name !== 'AbortError') onMessage('The invitation could not be shared from this browser.')
    }
  }

  return (
    <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="date-choice-sheet date-share-room" role="dialog" aria-modal="true" aria-labelledby="share-room-title">
        <span className="section-pill">Swipe together</span>
        <h2 id="share-room-title">Your DateMatch room is ready.</h2>
        <p>The other person gets the same twelve places. Choices stay private until you both choose the same location.</p>
        <input value={room.url} readOnly aria-label="DateMatch invitation link" />
        <div className="date-choice-actions"><button type="button" onClick={copy}>Copy link</button><button type="button" onClick={share}>Share invitation</button><Link href={room.url}>Open room</Link></div>
      </section>
    </div>
  )
}

function SoloDeckSummary({ feed, choices, onSwipeTogether, busy, onRefresh }) {
  const selected = feed.items
    .filter((item) => ['save', 'perfect'].includes(choices[item.content_id]?.choice))
    .sort((a, b) => Number(choices[b.content_id]?.choice === 'perfect') - Number(choices[a.content_id]?.choice === 'perfect'))
    .slice(0, 4)

  return (
    <section className="date-deck-summary swipe-v2-summary">
      <div className="swipe-summary-celebration" aria-hidden="true"><span>♥</span><span>★</span><span>♥</span></div>
      <span className="section-pill">Deck complete</span>
      <h2>{selected.length ? 'Your shortlist has real possibilities.' : 'Let’s tune the next deck.'}</h2>
      <p>{selected.length ? 'Send the same deck to someone and reveal only the places you independently agree on.' : 'Try a different mood, radius, or price range instead of forcing a weak choice.'}</p>
      {selected.length ? (
        <div className="date-summary-grid">
          {selected.map((item) => (
            <article key={item.content_id}>
              <span>{choices[item.content_id]?.choice === 'perfect' ? '★ Perfect Pick' : '♥ Saved'}</span>
              <h3>{item.title}</h3>
              <p>{item.summary || categoryLabel(item.category)}</p>
              <div><small>{item.distanceLabel}</small><small>{item.priceLabel}</small></div>
              <Link href={item.href}>View location →</Link>
            </article>
          ))}
        </div>
      ) : null}
      <div className="date-summary-actions"><button type="button" onClick={onSwipeTogether} disabled={busy || !selected.length}>Swipe together</button><button type="button" onClick={onRefresh}>Build another deck</button></div>
    </section>
  )
}

export function DateSwipeWorkspaceV2({ initialFeed, googleMapsBrowserKey = '' }) {
  const [feed, setFeed] = useState({ ...initialFeed, items: initialFeed.items.slice(0, 12) })
  const [filters, setFilters] = useState({ ...initialFeed.filters, kind: 'place', date: 'any', limit: 12 })
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState({})
  const [pendingChoice, setPendingChoice] = useState(null)
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [actionEffect, setActionEffect] = useState(null)

  const current = feed.items[index] || null
  const categories = useMemo(() => [...new Set(feed.items.map((item) => item.category).filter(Boolean))].sort(), [feed.items])
  const positiveCount = useMemo(() => Object.values(choices).filter((entry) => entry.choice === 'save' || entry.choice === 'perfect').length, [choices])
  const perfectCount = useMemo(() => Object.values(choices).filter((entry) => entry.choice === 'perfect').length, [choices])
  const progress = feed.items.length ? Math.min(100, Math.round((index / feed.items.length) * 100)) : 0

  useEffect(() => {
    function shortcuts(event) {
      if (!current || busy || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'z' || key === 'u') { event.preventDefault(); undo() }
      if (key === 'p') { event.preventDefault(); requestChoice('perfect', current) }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value, kind: 'place', date: 'any', limit: 12 }))
  }

  function flashAction(action, duration = 360) {
    setActionEffect(action)
    window.setTimeout(() => setActionEffect((value) => value === action ? null : value), duration)
  }

  async function refresh(nextFilters = filters) {
    setLoading(true)
    setMessage('Building a fresh image-first deck…')
    const normalized = { ...nextFilters, kind: 'place', date: 'any', limit: 12 }
    const response = await fetch(`/api/discovery?${queryString(normalized)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) return setMessage(result.error || 'Your location deck could not refresh.')
    setFeed({ ...result, items: (result.items || []).slice(0, 12) })
    setFilters({ ...result.filters, kind: 'place', date: 'any', limit: 12 })
    setIndex(0)
    setChoices({})
    setShowFilters(false)
    setMessage('New deck ready. Photos and useful descriptions are prioritized first.')
  }

  function useLocation() {
    if (!navigator.geolocation) return setMessage('Location is not available in this browser.')
    setMessage('Finding interesting places near you…')
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { ...filters, latitude: position.coords.latitude, longitude: position.coords.longitude, kind: 'place', date: 'any', limit: 12 }
      setFilters(next)
      refresh(next)
    }, () => setMessage('Location permission was not granted.'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
  }

  async function persistChoice(action, item, note = '') {
    if (!item || busy) return
    setBusy(true)
    flashAction(action, 620)
    vibrate(action === 'perfect' ? [25, 20, 55] : action === 'save' ? 24 : 14)
    const persistedAction = action === 'pass' ? 'dismissed' : action === 'perfect' ? 'perfect' : 'saved'
    const response = await csrfFetch('/api/discovery/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: persistedAction, contentKind: 'place', contentId: item.content_id, requestId: feed.requestId })
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      setMessage(result.error || 'That choice could not be saved.')
      setBusy(false)
      return
    }
    setChoices((currentChoices) => ({ ...currentChoices, [item.content_id]: { choice: action, note } }))
    setIndex((currentIndex) => currentIndex + 1)
    setMessage(action === 'perfect' ? `Perfect Pick · ${item.title}` : action === 'save' ? `Saved · ${item.title}` : `Passed · ${item.title}`)
    setPendingChoice(null)
    setBusy(false)
  }

  function requestChoice(action, item) {
    if (!item || busy) return
    if (action === 'save' || action === 'perfect') {
      flashAction(action)
      vibrate(action === 'perfect' ? [18, 15, 35] : 18)
      setPendingChoice({ choice: action, item })
    } else persistChoice('pass', item)
  }

  async function undo() {
    const previousIndex = Math.max(0, index - 1)
    const item = feed.items[previousIndex]
    if (!item || index === 0 || busy) return
    setBusy(true)
    flashAction('undo', 620)
    vibrate(18)
    const response = await csrfFetch('/api/discovery/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', contentKind: 'place', contentId: item.content_id, requestId: feed.requestId })
    })
    if (response.ok) {
      setIndex(previousIndex)
      setChoices((currentChoices) => { const next = { ...currentChoices }; delete next[item.content_id]; return next })
      setMessage(`Brought back · ${item.title}`)
    } else setMessage('Your last choice could not be undone.')
    setBusy(false)
  }

  async function startDateMatch() {
    if (busy || feed.items.length < 2) return
    setBusy(true)
    setMessage('Creating a private shared deck…')
    const response = await csrfFetch('/api/date-match/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationIds: feed.items.map((item) => item.content_id), center: feed.center,
        choices: Object.entries(choices).map(([locationId, value]) => ({ locationId, ...value }))
      })
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok) {
      setRoom(result)
      setMessage('DateMatch room created. Send the invitation when you are ready.')
    } else setMessage(result.error || 'The shared deck could not be created.')
    setBusy(false)
  }

  return (
    <div className="date-swipe-workspace swipe-v2">
      <section className="swipe-v2-command-bar">
        <div className="swipe-v2-progress-copy">
          <span className="section-pill">Live deck</span>
          <strong>{current ? `${index + 1} of ${feed.items.length}` : 'Complete'}</strong>
          <small>{positiveCount} saved · {perfectCount} perfect</small>
        </div>
        <div className="swipe-v2-progress" role="progressbar" aria-label="Deck progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
        <div className="swipe-v2-tools">
          <button className="date-filter-toggle" type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}><span aria-hidden="true">⌁</span> Filters</button>
          <button className="date-swipe-together" type="button" onClick={startDateMatch} disabled={busy}><span aria-hidden="true">♡⇄♡</span> Swipe together</button>
        </div>
      </section>

      {showFilters ? (
        <form className="date-filter-panel swipe-v2-filter-panel" onSubmit={(event) => { event.preventDefault(); refresh() }}>
          <div className="swipe-filter-heading"><div><span className="section-pill section-pill-yellow">Tune this deck</span><h2>What sounds good right now?</h2></div><button type="button" onClick={() => setShowFilters(false)} aria-label="Close filters">×</button></div>
          <label className="wide">Mood or idea<input value={filters.q || ''} onChange={(event) => updateFilter('q', event.target.value)} placeholder="Coffee, rooftop, museum, sunset…" /></label>
          <label>Location type<select value={filters.category || ''} onChange={(event) => updateFilter('category', event.target.value)}><option value="">Anything interesting</option>{categories.map((category) => <option value={category} key={category}>{categoryLabel(category)}</option>)}</select></label>
          <label>Maximum distance<span className="date-distance-input"><input aria-label="Maximum distance" type="number" min="1" max="100" value={filters.distance || 10} onChange={(event) => updateFilter('distance', Number(event.target.value))} /><small>km</small></span></label>
          <label>Price<select value={filters.price || 'any'} onChange={(event) => updateFilter('price', event.target.value)}><option value="any">Any price</option><option value="1">$ · inexpensive</option><option value="2">$$ · moderate</option><option value="3">$$$ · higher</option><option value="4">$$$$ · premium</option></select></label>
          <label>Amenity<input value={filters.amenity || ''} onChange={(event) => updateFilter('amenity', event.target.value)} placeholder="patio, views, parking…" /></label>
          <label className="date-check"><span>Open now</span><input type="checkbox" checked={Boolean(filters.openNow)} onChange={(event) => updateFilter('openNow', event.target.checked)} /></label>
          <label className="date-check"><span>Accessible</span><input type="checkbox" checked={Boolean(filters.accessible)} onChange={(event) => updateFilter('accessible', event.target.checked)} /></label>
          <div className="date-filter-actions"><button type="submit">{loading ? 'Finding places…' : 'Build this deck'}</button><button type="button" onClick={useLocation}>Use my location</button></div>
        </form>
      ) : null}

      {positiveCount >= 4 && current ? <p className="date-swipe-message">Your shortlist is already strong. Keep exploring or invite someone now.</p> : null}
      {message ? <p className={`date-swipe-message swipe-v2-toast ${actionEffect ? `is-${actionEffect}` : ''}`} role="status" aria-live="polite">{message}</p> : null}

      <div className={`date-deck-stage swipe-v2-stage ${current && index < feed.items.length - 1 ? 'has-next-card' : ''} ${actionEffect ? `is-${actionEffect}` : ''}`}>
        {current ? (
          <DateLocationCard
            key={current.content_id}
            item={current}
            onChoice={requestChoice}
            onMessage={setMessage}
            busy={busy}
            googleMapsBrowserKey={googleMapsBrowserKey}
            allowPerfect
            puddlePick={index === 0}
          />
        ) : (
          <SoloDeckSummary feed={feed} choices={choices} onSwipeTogether={startDateMatch} busy={busy} onRefresh={() => refresh()} />
        )}
      </div>

      {current ? (
        <SwipeActionDock
          onUndo={undo}
          onPass={() => requestChoice('pass', current)}
          onSave={() => requestChoice('save', current)}
          onPerfect={() => requestChoice('perfect', current)}
          canUndo={index > 0}
          busy={busy}
          intent={actionEffect}
        />
      ) : null}

      <ChoiceNoteModal key={`${pendingChoice?.item?.content_id || 'none'}:${pendingChoice?.choice || ''}`} pending={pendingChoice} busy={busy} onCancel={() => setPendingChoice(null)} onSubmit={(note) => persistChoice(pendingChoice.choice, pendingChoice.item, note)} />
      <ShareRoomPanel room={room} onClose={() => setRoom(null)} onMessage={setMessage} />
    </div>
  )
}
