"use client"

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DISCOVERY_IMAGE_SIZES, canOptimizeDiscoveryImage } from '@/lib/media/discovery-image'
import { useModalFocus } from '@/components/modal-focus'
import { SwipeMapPreview } from '@/components/swipe-map-preview'

const labels = {
  cafe: 'Coffee', restaurant: 'Restaurant', bar: 'Bar', park: 'Park', museum: 'Museum',
  gallery: 'Gallery', attraction: 'Attraction', activity_venue: 'Activity', study_spot: 'Study',
  scenic_spot: 'Scenic', nightlife: 'Nightlife', shop: 'Shop', community_space: 'Community'
}

const SWIPE_EXIT_DURATION_MS = 360
const SWIPE_ROTATION_MAX_DEG = 12
const SWIPE_ROTATION_DISTANCE = 30

function categoryLabel(value) {
  return labels[value] || String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function addressLabel(item) {
  return item.address_public || item.addressPublic || [item.address, item.neighborhood, item.city].filter(Boolean).join(', ') || item.city || ''
}

function photos(item) {
  const values = [...(item.photo_urls || []), item.photo_url, item.cover_url].filter(Boolean)
  return [...new Set(values)].slice(0, 5)
}

function hasCoordinates(item) {
  return Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))
}

function preventNativeImageDrag(event) {
  event.preventDefault()
}

function rotationFor(offset) {
  return Math.max(-SWIPE_ROTATION_MAX_DEG, Math.min(SWIPE_ROTATION_MAX_DEG, offset / SWIPE_ROTATION_DISTANCE))
}

function DetailsPhoto({ url, title, index }) {
  const [failed, setFailed] = useState(false)
  const alt = index ? `${title} photo ${index + 1}` : title
  if (failed) return <div className="figma-swipe-details-photo-empty" role="img" aria-label={`${alt}: photo unavailable`}>Photo unavailable</div>
  if (canOptimizeDiscoveryImage(url)) {
    return <Image src={url} alt={alt} width={420} height={260} sizes="(max-width: 760px) 50vw, 310px" draggable={false} onDragStart={preventNativeImageDrag} onError={() => setFailed(true)} />
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" draggable="false" onDragStart={preventNativeImageDrag} onError={() => setFailed(true)} />
}

function DetailsDialog({ item, photoUrls, onChoice, busy, onClose }) {
  const close = useRef(null)
  const dialog = useRef(null)
  useModalFocus(dialog, close)
  useEffect(() => {
    function keydown(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])

  return <div className="figma-swipe-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="figma-swipe-details" role="dialog" aria-modal="true" aria-label={`Full details for ${item.title}`} tabIndex={-1}>
      <button ref={close} type="button" className="figma-swipe-details-close" onClick={onClose} aria-label="Close details">×</button>
      {photoUrls.length ? <div className="figma-swipe-details-gallery">{photoUrls.slice(0, 3).map((url, index) => <DetailsPhoto url={url} title={item.title} index={index} key={url} />)}</div> : null}
      <span className="figma-swipe-details-kicker">{categoryLabel(item.category)}</span>
      <h2>{item.title}</h2>
      <p>{addressLabel(item)}</p>
      {item.summary ? <p className="figma-swipe-details-summary">{item.summary}</p> : null}
      {(item.amenities || []).length ? <div className="figma-swipe-details-tags">{item.amenities.slice(0, 6).map((value) => <span key={value}>{String(value).replaceAll('_', ' ')}</span>)}</div> : null}
      <div className="figma-swipe-details-actions">
        <button type="button" onClick={() => onChoice('pass')} disabled={busy}>Pass</button>
        <button type="button" onClick={() => onChoice('save')} disabled={busy}>Save</button>
        <button type="button" onClick={() => onChoice('perfect')} disabled={busy}>Star</button>
      </div>
    </section>
  </div>
}

export function FigmaSwipeCard({ item, onChoice, busy, actionRequest, preview = false, onLeavingChange, onActionHandled }) {
  const cardRef = useRef(null)
  const pointerId = useRef(null)
  const originX = useRef(0)
  const choiceInFlight = useRef(false)
  const dragXRef = useRef(0)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [mainPhotoFailed, setMainPhotoFailed] = useState(false)
  const photoUrls = useMemo(() => photos(item), [item])
  const mainPhoto = photoUrls[0] || null
  const optimizedMainPhoto = mainPhoto && canOptimizeDiscoveryImage(mainPhoto) ? mainPhoto : null

  useEffect(() => setMainPhotoFailed(false), [mainPhoto])

  function updateDragX(value) {
    dragXRef.current = value
    setDragX(value)
  }

  function exitOffset(direction) {
    const currentOffset = dragXRef.current
    const rect = cardRef.current.getBoundingClientRect()
    const clearance = Math.hypot(rect.width, rect.height)
    const targetEdge = direction < 0 ? -clearance : window.innerWidth + clearance
    const travel = direction < 0 ? targetEdge - rect.right : targetEdge - rect.left
    return currentOffset + travel
  }

  async function choose(action) {
    if (preview || busy || choiceInFlight.current) return
    choiceInFlight.current = true
    setDragging(false)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const direction = action === 'pass' ? -1 : action === 'save' ? 1 : 0
    const duration = reduced || !direction ? 0 : SWIPE_EXIT_DURATION_MS
    if (direction && !reduced) {
      setLeaving(true)
      onLeavingChange?.(true)
      updateDragX(exitOffset(direction))
    } else {
      updateDragX(0)
    }
    try {
      if (duration) await new Promise((resolve) => window.setTimeout(resolve, duration))
      await onChoice(action, item)
    } finally {
      updateDragX(0)
      setLeaving(false)
      onLeavingChange?.(false)
      choiceInFlight.current = false
    }
  }

  useEffect(() => {
    if (!preview && actionRequest?.id) {
      onActionHandled?.(actionRequest.id)
      choose(actionRequest.action)
    }
  }, [actionRequest?.id, onActionHandled, preview])

  function pointerDown(event) {
    if (busy || event.button !== 0 || !event.isPrimary || event.target.closest('button,a')) return
    event.preventDefault()
    pointerId.current = event.pointerId
    originX.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function pointerMove(event) {
    if (!dragging || pointerId.current !== event.pointerId) return
    updateDragX(event.clientX - originX.current)
  }
  function pointerUp(event) {
    if (pointerId.current !== event.pointerId) return
    const delta = event.clientX - originX.current
    pointerId.current = null
    setDragging(false)
    if (delta <= -90) choose('pass')
    else if (delta >= 90) choose('save')
    else updateDragX(0)
  }
  function pointerCancel(event) {
    if (pointerId.current !== event.pointerId) return
    pointerId.current = null
    setDragging(false)
    updateDragX(0)
  }

  const showMainPhoto = Boolean(mainPhoto) && !mainPhotoFailed
  const showMapFallback = !showMainPhoto && hasCoordinates(item)
  const locationId = item.location_id || item.content_id || item.id || ''

  return <>
    <article
      ref={cardRef}
      className={`figma-swipe-card ${preview ? 'is-preview' : 'is-active'}${dragging ? ' is-dragging' : ''}${leaving ? ' is-leaving' : ''}`}
      data-location-id={locationId || undefined}
      data-card-role={preview ? 'preview' : 'active'}
      style={preview ? undefined : { transform: `translateX(${dragX}px) rotate(${rotationFor(dragX)}deg)` }}
      onPointerDown={preview ? undefined : pointerDown}
      onPointerMove={preview ? undefined : pointerMove}
      onPointerUp={preview ? undefined : pointerUp}
      onPointerCancel={pointerCancel}
      onLostPointerCapture={pointerCancel}
      tabIndex={preview ? -1 : 0}
      onKeyDown={preview ? undefined : (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); choose('pass') }
        if (event.key === 'ArrowRight') { event.preventDefault(); choose('save') }
        if (event.key === 'Enter' || event.key === 'ArrowUp') { event.preventDefault(); setDetailsOpen(true) }
      }}
      aria-hidden={preview ? true : undefined}
      aria-label={preview ? undefined : `${item.title}. Swipe left to pass, right to save, or press Enter for details.`}
    >
      <div className="figma-swipe-card-photo">
        {optimizedMainPhoto && showMainPhoto ? <Image src={optimizedMainPhoto} alt={item.title} fill sizes={DISCOVERY_IMAGE_SIZES} preload draggable={false} onDragStart={preventNativeImageDrag} onError={() => setMainPhotoFailed(true)} /> : null}
        {!optimizedMainPhoto && showMainPhoto ? <img src={mainPhoto} alt={item.title} loading="eager" decoding="async" draggable="false" onDragStart={preventNativeImageDrag} onError={() => setMainPhotoFailed(true)} /> : null}
        {showMapFallback ? <SwipeMapPreview key={item.content_id} latitude={item.latitude} longitude={item.longitude} title={item.title} /> : null}
        {!showMainPhoto && !showMapFallback ? <div className="figma-swipe-card-photo-empty" role="img" aria-label="No verified photo is available and no map location is available">Photo unavailable</div> : null}
      </div>
      <div className="figma-swipe-card-meta"><span>{categoryLabel(item.category)}</span>{item.distanceLabel ? <span>{item.distanceLabel}</span> : null}</div>
      <div className="figma-swipe-card-copy"><h1>{item.title}</h1><p>{addressLabel(item)}</p></div>
      {!preview ? <>
        <strong className="figma-swipe-drag-label is-pass" style={{ opacity: Math.max(0, -dragX / 90) }}>PASS</strong>
        <strong className="figma-swipe-drag-label is-save" style={{ opacity: Math.max(0, dragX / 90) }}>SAVE</strong>
        <button className="figma-swipe-details-button" type="button" aria-label="Open details" onClick={() => setDetailsOpen(true)} disabled={busy}>+</button>
      </> : null}
    </article>
    {!preview && detailsOpen ? <DetailsDialog item={item} photoUrls={photoUrls} busy={busy} onChoice={async (action) => { setDetailsOpen(false); await choose(action) }} onClose={() => setDetailsOpen(false)} /> : null}
  </>
}
