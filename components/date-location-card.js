"use client"

import Link from 'next/link'
import { useRef, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'

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

function pickReasons(item) {
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
  if (item.photo_attribution_url) {
    return <a className={className} href={item.photo_attribution_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{label} ↗</a>
  }
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
  const puddleReasons = puddlePick ? pickReasons(item) : []
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
    } else if (!crossed && Math.abs(nextX) < 55 && nextY > -55) {
      thresholdBuzzed.current = false
    }
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
    } else if (dragX <= -85) {
      choose('pass')
    } else if (dragX >= 85) {
      choose('save')
    } else {
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
        {puddlePick && puddleReasons.length ? <div className="date-puddle-pick-reasons">{puddleReasons.map((reason) => <span key={reason}>✦ {reason}</span>)}</div> : reasons.length ? <div className="date-fit-list">{reasons.map((reason) => <span key={reason}>♡ {reason}</span>)}</div> : null}
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
