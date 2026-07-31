"use client"

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'
import { csrfFetch } from '@/lib/security/csrf-client'

const categoryLabels = {
  cafe: 'Coffee shop',
  restaurant: 'Restaurant',
  bar: 'Bar or lounge',
  park: 'Park or garden',
  museum: 'Museum',
  gallery: 'Gallery',
  attraction: 'Local attraction',
  activity_venue: 'Activity date',
  study_spot: 'Quiet hangout',
  scenic_spot: 'Scenic spot',
  nightlife: 'Nightlife',
  shop: 'Market or shop',
  community_space: 'Local community spot',
  other: 'Local date idea'
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

function categoryLabel(category) {
  return categoryLabels[category] || String(category || 'Local date idea').replaceAll('_', ' ')
}

function costLabel(priceLevel) {
  const level = Number(priceLevel || 0)
  if (level === 1) return 'Usually under $20/person'
  if (level === 2) return 'Usually $20–40/person'
  if (level === 3) return 'Usually $40–75/person'
  if (level === 4) return 'Usually $75+/person'
  return 'Price varies'
}

function dateReasons(item) {
  const category = String(item.category || '')
  const amenities = new Set((item.amenities || []).map((value) => String(value).toLowerCase()))
  const reasons = []
  if (['cafe', 'museum', 'gallery', 'park', 'scenic_spot', 'study_spot', 'shop'].includes(category)) reasons.push('Easy place to talk')
  if (['activity_venue', 'attraction'].includes(category)) reasons.push('Built-in conversation starter')
  if (['park', 'scenic_spot'].includes(category) || amenities.has('outdoors') || amenities.has('views')) reasons.push('Great for a walk or sunset')
  if (['bar', 'nightlife'].includes(category)) reasons.push('Good for an evening date')
  if (category === 'restaurant') reasons.push('Works for dinner or brunch')
  if (amenities.has('late-night')) reasons.push('Open for a later date')
  if (item.open_now) reasons.push('Open right now')
  if (item.accessibility?.wheelchair_accessible || item.accessibility?.step_free || amenities.has('accessible')) reasons.push('Accessibility information available')
  return [...new Set(reasons)].slice(0, 3)
}

function puddlePickReasons(item) {
  const reasons = [...(item.puddle_pick_reasons || [])]
  if (!reasons.length) reasons.push(...dateReasons(item))
  if (Number(item.distance_m) <= 5000) reasons.unshift('Convenient distance')
  if ([1, 2].includes(Number(item.price_level))) reasons.push('Comfortable everyday price')
  return [...new Set(reasons)].slice(0, 4)
}

function PhotoCredit({ item, compact = false }) {
  if (!item.has_real_photo) return null
  const provider = String(item.photo_provider || '').replaceAll('_', ' ')
  const label = item.photo_attribution || (provider && provider !== 'puddle' ? `Photo via ${provider}` : 'Photo of this place')
  const className = compact ? 'date-photo-credit is-compact' : 'date-photo-credit'
  if (item.photo_attribution_url) return <a className={className} href={item.photo_attribution_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{label} ↗</a>
  return <span className={className}>{label}</span>
}

function DateLocationDetails({ item, onClose, onShare, partnerNote = null }) {
  const reasons = dateReasons(item)
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="date-details-sheet" role="dialog" aria-modal="true" aria-labelledby="date-details-title">
      <button className="date-details-close" type="button" onClick={onClose} aria-label="Close details">×</button>
      <span className="date-card-type">{categoryLabel(item.category)}</span>
      <h2 id="date-details-title">{item.title}</h2>
      <PhotoCredit item={item} />
      <p>{item.summary || 'A nearby place that could be worth a date.'}</p>
      {partnerNote ? <blockquote className="date-partner-note">“{partnerNote}”<small>Your date’s note</small></blockquote> : null}
      <div className="date-details-facts"><span>{item.distanceLabel}</span><span>{costLabel(item.price_level)}</span><span>{item.open_now ? 'Open now' : 'Check opening hours'}</span></div>
      {reasons.length ? <div className="date-fit-list">{reasons.map((reason) => <span key={reason}>✓ {reason}</span>)}</div> : null}
      {(item.amenities || []).length ? <div><h3>Good to know</h3><div className="date-amenity-list">{item.amenities.slice(0, 8).map((amenity) => <span key={amenity}>{String(amenity).replaceAll('_', ' ')}</span>)}</div></div> : null}
      <div className="date-details-actions"><button type="button" onClick={onShare}>Share this place</button><Link href={item.href}>Open full listing →</Link></div>
    </section>
  </div>
}

export function DateLocationCard({ item, onChoice, onMessage, busy, googleMapsBrowserKey, allowPerfect = false, puddlePick = false, partnerNote = null }) {
  const startX = useRef(null)
  const startY = useRef(null)
  const pointerId = useRef(null)
  const thresholdBuzzed = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [choiceEffect, setChoiceEffect] = useState(null)
  const reasons = dateReasons(item)
  const pickReasons = puddlePick ? puddlePickReasons(item) : []
  const photoUrl = item.photo_url || item.cover_url || null
  const useGoogleFallback = !photoUrl && item.content_kind === 'place' && Boolean(item.content_id)

  async function choose(action) {
    if (busy) return
    const direction = action === 'pass' ? -1 : 1
    setChoiceEffect(action)
    setDragging(false)
    setDragX(direction * 720)
    setDragY(0)
    vibrate(action === 'perfect' ? [30, 25, 70] : 25)
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    await onChoice(action, item)
    setDragX(0)
    setChoiceEffect(null)
  }

  function pointerDown(event) {
    if (busy || event.target.closest('button,a,input,textarea')) return
    startX.current = event.clientX
    startY.current = event.clientY
    pointerId.current = event.pointerId
    thresholdBuzzed.current = false
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function pointerMove(event) {
    if (!dragging || pointerId.current !== event.pointerId || startX.current === null) return
    const nextX = event.clientX - startX.current
    const nextY = event.clientY - startY.current
    if (nextY < 0 && Math.abs(nextY) > Math.abs(nextX)) {
      setDragX(0)
      setDragY(Math.max(-130, nextY))
    } else {
      setDragY(0)
      setDragX(Math.max(-180, Math.min(180, nextX)))
    }
    const crossed = Math.abs(nextX) >= 85 || nextY <= -75
    if (crossed && !thresholdBuzzed.current) {
      vibrate(12)
      thresholdBuzzed.current = true
    } else if (!crossed && Math.abs(nextX) < 55 && nextY > -55) thresholdBuzzed.current = false
  }

  function pointerUp(event) {
    if (pointerId.current !== event.pointerId) return
    setDragging(false)
    pointerId.current = null
    const upward = dragY <= -75 && Math.abs(dragY) > Math.abs(dragX)
    startX.current = null
    startY.current = null
    if (upward) {
      setDetailsOpen(true)
      setDragX(0)
      setDragY(0)
    } else if (dragX <= -85) choose('pass')
    else if (dragX >= 85) choose('save')
    else {
      setDragX(0)
      setDragY(0)
    }
  }

  async function share() {
    const url = new URL(item.href, window.location.origin).toString()
    try {
      if (navigator.share) await navigator.share({ title: item.title, text: `Would you go here for a date? ${item.title}`, url })
      else {
        await navigator.clipboard.writeText(url)
        onMessage('Place link copied. Send it to your date!')
      }
    } catch (error) {
      if (error?.name !== 'AbortError') onMessage('This place could not be shared from your browser.')
    }
  }

  const rotation = dragX / 24
  const saveOpacity = Math.max(0, dragX / 90)
  const passOpacity = Math.max(0, -dragX / 90)
  const detailsOpacity = Math.max(0, -dragY / 80)

  return <>
    <article
      className={`date-swipe-card ${dragging ? 'is-dragging' : ''} ${choiceEffect === 'perfect' ? 'is-perfecting' : ''}`}
      style={{ transform: `translate(${dragX}px,${dragY / 3}px) rotate(${rotation}deg)` }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') choose('pass')
        if (event.key === 'ArrowRight') choose('save')
        if (event.key === 'ArrowUp') setDetailsOpen(true)
      }}
      tabIndex="0"
      aria-label={`${item.title}. Use left arrow to pass, right arrow to save, or up arrow for details.`}
    >
      <div className="date-swipe-stamp is-save" style={{ opacity: choiceEffect === 'perfect' ? 0 : saveOpacity }}>SAVE</div>
      <div className="date-swipe-stamp is-pass" style={{ opacity: passOpacity }}>PASS</div>
      <div className="date-swipe-stamp is-details" style={{ opacity: detailsOpacity }}>DETAILS</div>
      <div className="date-swipe-stamp is-perfect" style={{ opacity: choiceEffect === 'perfect' ? 1 : 0 }}>PERFECT</div>
      <div className={`date-card-photo ${useGoogleFallback ? 'has-google-fallback' : ''}`} style={{ backgroundImage: photoUrl ? `linear-gradient(180deg,transparent 35%,rgba(19,12,17,.78)),url(${photoUrl})` : undefined }}>
        {useGoogleFallback ? <GooglePlacePhotoFallback title={item.title} locationId={item.content_id} placeId={item.google_place_id || null} apiKey={googleMapsBrowserKey} /> : null}
        {!photoUrl && !useGoogleFallback ? <div className="date-card-placeholder" aria-hidden="true"><span>⌖</span><small>Real photo coming soon</small></div> : null}
        {photoUrl ? <span className="date-real-photo-badge">✓ Real place photo</span> : null}
        {puddlePick ? <span className="date-puddle-pick-badge">✦ Puddle Pick</span> : null}
        {photoUrl ? <PhotoCredit item={item} compact /> : null}
        <div className="date-card-photo-meta"><span>{categoryLabel(item.category)}</span><span>{item.distanceLabel}</span></div>
      </div>
      <div className="date-card-content">
        <div className="date-card-title-row"><div><span className="date-card-eyebrow">{puddlePick ? 'Selected for this deck' : 'Date idea'}</span><h2>{item.title}</h2></div><strong>{item.priceLabel}</strong></div>
        <p>{item.summary || 'A nearby place that could be worth a date.'}</p>
        <div className="date-card-facts"><span>{costLabel(item.price_level)}</span><span>{item.open_now ? 'Open now' : 'Check hours'}</span></div>
        {puddlePick && pickReasons.length ? <div className="date-puddle-pick-reasons">{pickReasons.map((reason) => <span key={reason}>✦ {reason}</span>)}</div> : reasons.length ? <div className="date-fit-list">{reasons.map((reason) => <span key={reason}>♡ {reason}</span>)}</div> : null}
        {partnerNote ? <blockquote className="date-partner-note">“{partnerNote}”<small>Your date’s note</small></blockquote> : null}
        <div className={`date-card-actions ${allowPerfect ? 'has-perfect' : ''}`}>
          <button className="date-action-pass" type="button" onClick={() => choose('pass')} disabled={busy}><span aria-hidden="true">×</span> Pass</button>
          <button className="date-action-details" type="button" onClick={() => setDetailsOpen(true)}>Details</button>
          <button className="date-action-save" type="button" onClick={() => choose('save')} disabled={busy}><span aria-hidden="true">♡</span> Save</button>
          {allowPerfect ? <button className="date-action-perfect" type="button" onClick={() => choose('perfect')} disabled={busy}><span aria-hidden="true">★</span> Perfect Pick</button> : null}
        </div>
        <button className="date-share-button" type="button" onClick={share}>Share this place</button>
      </div>
    </article>
    {detailsOpen ? <DateLocationDetails item={item} partnerNote={partnerNote} onClose={() => setDetailsOpen(false)} onShare={share} /> : null}
  </>
}

function ChoiceNoteModal({ pending, busy, onCancel, onSubmit }) {
  const [note, setNote] = useState('')
  if (!pending) return null
  const perfect = pending.choice === 'perfect'
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="date-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="solo-note-title">
      <span className={`date-choice-icon ${perfect ? 'is-perfect' : ''}`} aria-hidden="true">{perfect ? '★' : '♡'}</span>
      <span className="section-pill">{perfect ? 'Perfect Pick' : 'Save this idea'}</span>
      <h2 id="solo-note-title">Why does {pending.item.title} stand out?</h2>
      <p>Add an optional note now. It will be ready if you invite someone to swipe this deck with you.</p>
      <textarea autoFocus maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Looks cozy and close to both of us…" />
      <small>{note.length}/280</small>
      <div className="date-choice-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className={perfect ? 'is-perfect' : ''} type="button" onClick={() => onSubmit(note)} disabled={busy}>{busy ? 'Saving…' : perfect ? 'Perfect Pick' : 'Save'}</button></div>
    </section>
  </div>
}

function ShareRoomPanel({ room, onClose, onMessage }) {
  if (!room) return null
  async function copy() {
    await navigator.clipboard.writeText(room.url)
    onMessage('DateMatch invitation copied.')
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Puddle DateMatch', text: 'Swipe these date ideas with me and see where we match.', url: room.url })
      else await copy()
    } catch (error) { if (error?.name !== 'AbortError') onMessage('The invitation could not be shared from this browser.') }
  }
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="date-choice-sheet date-share-room" role="dialog" aria-modal="true" aria-labelledby="share-room-title"><span className="section-pill">Swipe together</span><h2 id="share-room-title">Your DateMatch room is ready.</h2><p>Your date receives the same twelve ideas. Choices stay private until you both save the same place.</p><input value={room.url} readOnly aria-label="DateMatch invitation link" /><div className="date-choice-actions"><button type="button" onClick={copy}>Copy link</button><button type="button" onClick={share}>Share invitation</button><Link href={room.url}>Open room</Link></div></section></div>
}

function SoloDeckSummary({ feed, choices, onSwipeTogether, busy }) {
  const selected = feed.items.filter((item) => ['save', 'perfect'].includes(choices[item.content_id]?.choice)).sort((a, b) => Number(choices[b.content_id]?.choice === 'perfect') - Number(choices[a.content_id]?.choice === 'perfect')).slice(0, 3)
  return <section className="date-deck-summary">
    <span className="section-pill">Your best date options</span>
    <h2>{selected.length ? 'You have a shortlist worth sharing.' : 'This deck was not the one.'}</h2>
    <p>{selected.length ? 'Invite your date to swipe the same twelve ideas. The real reward happens when you independently choose the same place.' : 'Refresh the deck with different filters instead of forcing a weak choice.'}</p>
    {selected.length ? <div className="date-summary-grid">{selected.map((item) => <article key={item.content_id}><span>{choices[item.content_id]?.choice === 'perfect' ? '★ Perfect Pick' : '♡ Saved'}</span><h3>{item.title}</h3><dl><div><dt>Cost</dt><dd>{item.priceLabel}</dd></div><div><dt>Distance</dt><dd>{item.distanceLabel}</dd></div><div><dt>Best for</dt><dd>{dateReasons(item)[0] || 'A date idea you chose'}</dd></div></dl>{choices[item.content_id]?.note ? <blockquote>“{choices[item.content_id].note}”</blockquote> : null}<Link href={item.href}>View place →</Link></article>)}</div> : null}
    <div className="date-summary-actions"><button type="button" onClick={onSwipeTogether} disabled={busy}>Send these to my date</button><button type="button" onClick={() => window.location.reload()}>Start a fresh deck</button></div>
  </section>
}

export function DateSwipeWorkspace({ initialFeed, googleMapsBrowserKey = '' }) {
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
  const current = feed.items[index] || null
  const categories = useMemo(() => [...new Set(feed.items.map((item) => item.category).filter(Boolean))].sort(), [feed.items])
  const positiveCount = useMemo(() => Object.values(choices).filter((entry) => entry.choice === 'save' || entry.choice === 'perfect').length, [choices])

  function updateFilter(name, value) { setFilters((currentFilters) => ({ ...currentFilters, [name]: value, kind: 'place', date: 'any', limit: 12 })) }

  async function refresh(nextFilters = filters) {
    setLoading(true)
    setMessage('')
    const normalized = { ...nextFilters, kind: 'place', date: 'any', limit: 12 }
    const response = await fetch(`/api/discovery?${queryString(normalized)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) return setMessage(result.error || 'Your date deck could not refresh.')
    setFeed({ ...result, items: (result.items || []).slice(0, 12) })
    setFilters({ ...result.filters, kind: 'place', date: 'any', limit: 12 })
    setIndex(0)
    setChoices({})
    setShowFilters(false)
  }

  function useLocation() {
    if (!navigator.geolocation) return setMessage('Location is not available in this browser.')
    setMessage('Finding date ideas near you…')
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { ...filters, latitude: position.coords.latitude, longitude: position.coords.longitude, kind: 'place', date: 'any', limit: 12 }
      setFilters(next)
      refresh(next)
    }, () => setMessage('Location permission was not granted.'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
  }

  async function persistChoice(action, item, note = '') {
    setBusy(true)
    const persistedAction = action === 'pass' ? 'dismissed' : action === 'perfect' ? 'perfect' : 'saved'
    const response = await csrfFetch('/api/discovery/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: persistedAction, contentKind: 'place', contentId: item.content_id, requestId: feed.requestId }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      setMessage(result.error || 'That swipe could not be saved.')
      setBusy(false)
      return
    }
    setChoices((currentChoices) => ({ ...currentChoices, [item.content_id]: { choice: action, note } }))
    setIndex((currentIndex) => currentIndex + 1)
    setMessage(action === 'perfect' ? `Perfect Pick · ${item.title}` : action === 'save' ? `Saved for a date · ${item.title}` : `Passed · ${item.title}`)
    setPendingChoice(null)
    setBusy(false)
  }

  function requestChoice(action, item) {
    if (action === 'save' || action === 'perfect') setPendingChoice({ choice: action, item })
    else persistChoice('pass', item)
  }

  async function undo() {
    const previousIndex = Math.max(0, index - 1)
    const item = feed.items[previousIndex]
    if (!item || index === 0 || busy) return
    setBusy(true)
    const response = await csrfFetch('/api/discovery/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', contentKind: 'place', contentId: item.content_id, requestId: feed.requestId }) })
    if (response.ok) {
      setIndex(previousIndex)
      setChoices((currentChoices) => { const next = { ...currentChoices }; delete next[item.content_id]; return next })
      setMessage(`Brought back · ${item.title}`)
    } else setMessage('Your last swipe could not be undone.')
    setBusy(false)
  }

  async function startDateMatch() {
    if (busy || feed.items.length < 2) return
    setBusy(true)
    const response = await csrfFetch('/api/date-match/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationIds: feed.items.map((item) => item.content_id),
        center: feed.center,
        choices: Object.entries(choices).map(([locationId, value]) => ({ locationId, ...value }))
      })
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok) {
      setRoom(result)
      setMessage('DateMatch room created. Send the invitation to your date.')
    } else setMessage(result.error || 'The shared deck could not be created.')
    setBusy(false)
  }

  return <div className="date-swipe-workspace">
    <div className="date-swipe-toolbar">
      <button className="date-filter-toggle" type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>☰ Date filters</button>
      <span>{Math.min(index + 1, feed.items.length || 1)} of {feed.items.length} date ideas</span>
      <button className="date-swipe-together" type="button" onClick={startDateMatch} disabled={busy}>♡ Swipe together</button>
    </div>
    {showFilters ? <form className="date-filter-panel" onSubmit={(event) => { event.preventDefault(); refresh() }}>
      <label className="wide">What are you in the mood for?<input value={filters.q || ''} onChange={(event) => updateFilter('q', event.target.value)} placeholder="Coffee, rooftop, museum, sunset…" /></label>
      <label>Type<select value={filters.category || ''} onChange={(event) => updateFilter('category', event.target.value)}><option value="">Any kind of date</option>{categories.map((category) => <option value={category} key={category}>{categoryLabel(category)}</option>)}</select></label>
      <label>Maximum distance<span className="date-distance-input"><input aria-label="Maximum distance" type="number" min="1" max="100" value={filters.distance || 10} onChange={(event) => updateFilter('distance', Number(event.target.value))} /><small>km</small></span></label>
      <label>Price<select value={filters.price || 'any'} onChange={(event) => updateFilter('price', event.target.value)}><option value="any">Any price</option><option value="1">$ · inexpensive</option><option value="2">$$ · moderate</option><option value="3">$$$ · higher</option><option value="4">$$$$ · premium</option></select></label>
      <label>Amenity<input value={filters.amenity || ''} onChange={(event) => updateFilter('amenity', event.target.value)} placeholder="patio, views, parking…" /></label>
      <label className="date-check"><span>Open now</span><input type="checkbox" checked={Boolean(filters.openNow)} onChange={(event) => updateFilter('openNow', event.target.checked)} /></label>
      <label className="date-check"><span>Accessible</span><input type="checkbox" checked={Boolean(filters.accessible)} onChange={(event) => updateFilter('accessible', event.target.checked)} /></label>
      <div className="date-filter-actions"><button type="submit">{loading ? 'Finding places…' : 'Update my deck'}</button><button type="button" onClick={useLocation}>Use my location</button></div>
    </form> : null}
    {positiveCount >= 4 && current ? <p className="date-swipe-message">You have enough for a great shortlist. Finish the deck or invite your date now.</p> : null}
    {message ? <p className="date-swipe-message" role="status">{message}</p> : null}
    <div className={`date-deck-stage ${current && index < feed.items.length - 1 ? 'has-next-card' : ''}`}>
      {current ? <DateLocationCard key={current.content_id} item={current} onChoice={requestChoice} onMessage={setMessage} busy={busy} googleMapsBrowserKey={googleMapsBrowserKey} allowPerfect puddlePick={index === 0} /> : <SoloDeckSummary feed={feed} choices={choices} onSwipeTogether={startDateMatch} busy={busy} />}
    </div>
    {current ? <div className="date-deck-footer"><button type="button" onClick={undo} disabled={index === 0 || busy}>↶ Undo last swipe</button><span>Swipe left to pass, right to save, or up for details.</span></div> : null}
    <ChoiceNoteModal key={`${pendingChoice?.item?.content_id || 'none'}:${pendingChoice?.choice || ''}`} pending={pendingChoice} busy={busy} onCancel={() => setPendingChoice(null)} onSubmit={(note) => persistChoice(pendingChoice.choice, pendingChoice.item, note)} />
    <ShareRoomPanel room={room} onClose={() => setRoom(null)} onMessage={setMessage} />
  </div>
}
