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

function PhotoCredit({ item, compact = false }) {
  if (!item.has_real_photo) return null
  const provider = String(item.photo_provider || '').replaceAll('_', ' ')
  const label = item.photo_attribution || (provider && provider !== 'puddle' ? `Photo via ${provider}` : 'Photo of this place')
  const className = compact ? 'date-photo-credit is-compact' : 'date-photo-credit'
  if (item.photo_attribution_url) {
    return <a className={className} href={item.photo_attribution_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{label} ↗</a>
  }
  return <span className={className}>{label}</span>
}

function DateLocationDetails({ item, onClose, onShare }) {
  const reasons = dateReasons(item)
  return (
    <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="date-details-sheet" role="dialog" aria-modal="true" aria-labelledby="date-details-title">
        <button className="date-details-close" type="button" onClick={onClose} aria-label="Close details">×</button>
        <span className="date-card-type">{categoryLabel(item.category)}</span>
        <h2 id="date-details-title">{item.title}</h2>
        <PhotoCredit item={item} />
        <p>{item.summary || 'A nearby place that could be worth a date.'}</p>
        <div className="date-details-facts">
          <span>{item.distanceLabel}</span>
          <span>{costLabel(item.price_level)}</span>
          <span>{item.open_now ? 'Open now' : 'Check opening hours'}</span>
        </div>
        {reasons.length ? <div className="date-fit-list">{reasons.map((reason) => <span key={reason}>✓ {reason}</span>)}</div> : null}
        {(item.amenities || []).length ? <div><h3>Good to know</h3><div className="date-amenity-list">{item.amenities.slice(0, 8).map((amenity) => <span key={amenity}>{String(amenity).replaceAll('_', ' ')}</span>)}</div></div> : null}
        <div className="date-details-actions">
          <button type="button" onClick={onShare}>Share this place</button>
          <Link href={item.href}>Open full listing →</Link>
        </div>
      </section>
    </div>
  )
}

function DateLocationCard({ item, onChoice, onMessage, busy, googleMapsBrowserKey }) {
  const startX = useRef(null)
  const pointerId = useRef(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const reasons = dateReasons(item)
  const photoUrl = item.photo_url || item.cover_url || null
  const useGoogleFallback = !photoUrl && item.content_kind === 'place' && Boolean(item.content_id)

  async function choose(action) {
    if (busy) return
    const direction = action === 'saved' ? 1 : -1
    setDragging(false)
    setDragX(direction * 720)
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    await onChoice(action, item)
    setDragX(0)
  }

  function pointerDown(event) {
    if (busy || event.target.closest('button,a')) return
    startX.current = event.clientX
    pointerId.current = event.pointerId
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function pointerMove(event) {
    if (!dragging || pointerId.current !== event.pointerId || startX.current === null) return
    setDragX(Math.max(-180, Math.min(180, event.clientX - startX.current)))
  }

  function pointerUp(event) {
    if (pointerId.current !== event.pointerId) return
    setDragging(false)
    startX.current = null
    pointerId.current = null
    if (dragX <= -85) choose('dismissed')
    else if (dragX >= 85) choose('saved')
    else setDragX(0)
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

  return (
    <>
      <article
        className={`date-swipe-card ${dragging ? 'is-dragging' : ''}`}
        style={{ transform: `translateX(${dragX}px) rotate(${rotation}deg)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') choose('dismissed')
          if (event.key === 'ArrowRight') choose('saved')
        }}
        tabIndex="0"
        aria-label={`${item.title}. Use left arrow to pass or right arrow to save for a date.`}
      >
        <div className="date-swipe-stamp is-save" style={{ opacity: saveOpacity }}>SAVE</div>
        <div className="date-swipe-stamp is-pass" style={{ opacity: passOpacity }}>PASS</div>
        <div className={`date-card-photo ${useGoogleFallback ? 'has-google-fallback' : ''}`} style={{ backgroundImage: photoUrl ? `linear-gradient(180deg,transparent 35%,rgba(19,12,17,.78)),url(${photoUrl})` : undefined }}>
          {useGoogleFallback ? <GooglePlacePhotoFallback title={item.title} locationId={item.content_id} placeId={item.google_place_id || null} apiKey={googleMapsBrowserKey} /> : null}
          {!photoUrl && !useGoogleFallback ? <div className="date-card-placeholder" aria-hidden="true"><span>⌖</span><small>Real photo coming soon</small></div> : null}
          {photoUrl ? <span className="date-real-photo-badge">✓ Real place photo</span> : null}
          {useGoogleFallback ? <span className="date-real-photo-badge is-google">Google Maps photo</span> : null}
          {photoUrl ? <PhotoCredit item={item} compact /> : null}
          <div className="date-card-photo-meta"><span>{categoryLabel(item.category)}</span><span>{item.distanceLabel}</span></div>
        </div>
        <div className="date-card-content">
          <div className="date-card-title-row"><div><span className="date-card-eyebrow">Date idea</span><h2>{item.title}</h2></div><strong>{item.priceLabel}</strong></div>
          <p>{item.summary || 'A nearby place that could be worth a date.'}</p>
          <div className="date-card-facts"><span>{costLabel(item.price_level)}</span><span>{item.open_now ? 'Open now' : 'Check hours'}</span></div>
          {reasons.length ? <div className="date-fit-list">{reasons.map((reason) => <span key={reason}>♡ {reason}</span>)}</div> : null}
          <div className="date-card-actions">
            <button className="date-action-pass" type="button" onClick={() => choose('dismissed')} disabled={busy}><span aria-hidden="true">×</span> Pass</button>
            <button className="date-action-details" type="button" onClick={() => setDetailsOpen(true)}>Details</button>
            <button className="date-action-save" type="button" onClick={() => choose('saved')} disabled={busy}><span aria-hidden="true">♡</span> Save</button>
          </div>
          <button className="date-share-button" type="button" onClick={share}>Share with someone</button>
        </div>
      </article>
      {detailsOpen ? <DateLocationDetails item={item} onClose={() => setDetailsOpen(false)} onShare={share} /> : null}
    </>
  )
}

export function DateSwipeWorkspace({ initialFeed, googleMapsBrowserKey = '' }) {
  const [feed, setFeed] = useState(initialFeed)
  const [filters, setFilters] = useState({ ...initialFeed.filters, kind: 'place', date: 'any' })
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const current = feed.items[index] || null
  const categories = useMemo(() => [...new Set(feed.items.map((item) => item.category).filter(Boolean))].sort(), [feed.items])

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({ ...currentFilters, [name]: value, kind: 'place', date: 'any' }))
  }

  async function refresh(nextFilters = filters) {
    setLoading(true)
    setMessage('')
    const normalized = { ...nextFilters, kind: 'place', date: 'any' }
    const response = await fetch(`/api/discovery?${queryString(normalized)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) {
      setMessage(result.error || 'Your date deck could not refresh.')
      return
    }
    setFeed(result)
    setFilters({ ...result.filters, kind: 'place', date: 'any' })
    setIndex(0)
    setShowFilters(false)
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setMessage('Location is not available in this browser.')
      return
    }
    setMessage('Finding date ideas near you…')
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { ...filters, latitude: position.coords.latitude, longitude: position.coords.longitude, kind: 'place', date: 'any' }
      setFilters(next)
      refresh(next)
    }, () => setMessage('Location permission was not granted.'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
  }

  async function choose(action, item) {
    setBusy(true)
    setMessage(action === 'saved' ? `Saved for a date · ${item.title}` : `Passed · ${item.title}`)
    const response = await csrfFetch('/api/discovery/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, contentKind: 'place', contentId: item.content_id, requestId: feed.requestId })
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      setMessage(result.error || 'That swipe could not be saved.')
      setBusy(false)
      return
    }
    setIndex((currentIndex) => currentIndex + 1)
    setBusy(false)
  }

  async function undo() {
    const previousIndex = Math.max(0, index - 1)
    const item = feed.items[previousIndex]
    if (!item || index === 0 || busy) return
    setBusy(true)
    const response = await csrfFetch('/api/discovery/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo', contentKind: 'place', contentId: item.content_id, requestId: feed.requestId })
    })
    if (response.ok) {
      setIndex(previousIndex)
      setMessage(`Brought back · ${item.title}`)
    } else setMessage('Your last swipe could not be undone.')
    setBusy(false)
  }

  return (
    <div className="date-swipe-workspace">
      <div className="date-swipe-toolbar">
        <button className="date-filter-toggle" type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>☰ Date filters</button>
        <span>{Math.min(index + 1, feed.items.length || 1)} of {feed.items.length} nearby places</span>
        <Link href="/plans">View saved date ideas →</Link>
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

      {message ? <p className="date-swipe-message" role="status">{message}</p> : null}

      <div className="date-deck-stage">
        {current ? <DateLocationCard key={current.content_id} item={current} onChoice={choose} onMessage={setMessage} busy={busy} googleMapsBrowserKey={googleMapsBrowserKey} /> : <section className="date-deck-empty"><span aria-hidden="true">♡</span><h2>You reached the end of this date deck.</h2><p>Adjust your filters or widen the distance to find more places.</p><div><button type="button" onClick={() => setShowFilters(true)}>Change filters</button><button type="button" onClick={() => refresh()}>Refresh deck</button></div></section>}
      </div>

      <div className="date-deck-footer">
        <button type="button" onClick={undo} disabled={index === 0 || busy}>↶ Undo last swipe</button>
        <span>Tip: drag the card, or use your keyboard’s left and right arrows.</span>
      </div>
    </div>
  )
}
