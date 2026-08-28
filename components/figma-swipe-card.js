"use client"

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DISCOVERY_IMAGE_SIZES, canOptimizeDiscoveryImage } from '@/lib/media/discovery-image'
import { useModalFocus } from '@/components/modal-focus'

const labels = {
  cafe: 'Coffee', restaurant: 'Restaurant', bar: 'Bar', park: 'Park', museum: 'Museum',
  gallery: 'Gallery', attraction: 'Attraction', activity_venue: 'Activity', study_spot: 'Study',
  scenic_spot: 'Scenic', nightlife: 'Nightlife', shop: 'Shop', community_space: 'Community'
}

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

function DetailsPhoto({ url, title, index }) {
  const [failed, setFailed] = useState(false)
  const alt = index ? `${title} photo ${index + 1}` : title
  if (failed) return <div className="figma-swipe-details-photo-empty" role="img" aria-label={`${alt}: photo unavailable`}>Photo unavailable</div>
  if (canOptimizeDiscoveryImage(url)) {
    return <Image src={url} alt={alt} width={420} height={260} sizes="(max-width: 760px) 50vw, 310px" onError={() => setFailed(true)} />
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
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

export function FigmaSwipeCard({ item, onChoice, busy, actionRequest, preview = false, onExitChange }) {
  const pointerId = useRef(null)
  const originX = useRef(0)
  const choiceInFlight = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [mainPhotoFailed, setMainPhotoFailed] = useState(false)
  const photoUrls = useMemo(() => photos(item), [item])
  const mainPhoto = photoUrls[0] || null
  const optimizedMainPhoto = mainPhoto && canOptimizeDiscoveryImage(mainPhoto) ? mainPhoto : null

  useEffect(() => setMainPhotoFailed(false), [mainPhoto])

  async function choose(action) {
    if (preview || busy || choiceInFlight.current) return
    choiceInFlight.current = true
    setDragging(false)
    const horizontalSwipe = action === 'pass' || action === 'save'
    const exitDistance = horizontalSwipe ? Math.max(window.innerWidth + 240, 960) : 0
    if (horizontalSwipe) onExitChange?.(true)
    setDragX(action === 'pass' ? -exitDistance : action === 'save' ? exitDistance : 0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 0 : horizontalSwipe ? 420 : 0
    try {
      if (duration) await new Promise((resolve) => window.setTimeout(resolve, duration))
      await onChoice(action, item)
    } finally {
      setDragX(0)
      if (horizontalSwipe) onExitChange?.(false)
      choiceInFlight.current = false
    }
  }

  useEffect(() => {
    if (!preview && actionRequest?.id) choose(actionRequest.action)
  }, [actionRequest?.id, preview])

  function pointerDown(event) {
    if (preview || busy || event.target.closest('button,a')) return
    pointerId.current = event.pointerId
    originX.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function pointerMove(event) {
    if (preview || !dragging || pointerId.current !== event.pointerId) return
    setDragX(Math.max(-180, Math.min(180, event.clientX - originX.current)))
  }
  function pointerUp(event) {
    if (preview || pointerId.current !== event.pointerId) return
    const delta = event.clientX - originX.current
    pointerId.current = null
    setDragging(false)
    if (delta <= -90) choose('pass')
    else if (delta >= 90) choose('save')
    else setDragX(0)
  }

  const showMainPhoto = Boolean(mainPhoto) && !mainPhotoFailed
  const locationId = item.location_id || item.content_id || item.id || ''

  return <>
    <article
      className={`figma-swipe-card ${preview ? 'is-deck-preview' : 'is-deck-front'}${dragging ? ' is-dragging' : ''}${choiceInFlight.current ? ' is-exiting' : ''}`}
      data-location-id={locationId || undefined}
      style={preview ? undefined : { transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)` }}
      onPointerDown={preview ? undefined : pointerDown}
      onPointerMove={preview ? undefined : pointerMove}
      onPointerUp={preview ? undefined : pointerUp}
      onPointerCancel={preview ? undefined : pointerUp}
      tabIndex={preview ? -1 : 0}
      aria-hidden={preview || undefined}
      onKeyDown={preview ? undefined : (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); choose('pass') }
        if (event.key === 'ArrowRight') { event.preventDefault(); choose('save') }
        if (event.key === 'Enter' || event.key === 'ArrowUp') { event.preventDefault(); setDetailsOpen(true) }
      }}
      aria-label={preview ? undefined : `${item.title}. Swipe left to pass, right to save, or press Enter for details.`}
    >
      <div className="figma-swipe-card-photo">
        {optimizedMainPhoto && showMainPhoto ? <Image src={optimizedMainPhoto} alt={preview ? '' : item.title} fill sizes={DISCOVERY_IMAGE_SIZES} preload={!preview} onError={() => setMainPhotoFailed(true)} /> : null}
        {!optimizedMainPhoto && showMainPhoto ? <img src={mainPhoto} alt={preview ? '' : item.title} loading={preview ? 'eager' : 'eager'} decoding="async" onError={() => setMainPhotoFailed(true)} /> : null}
        {!showMainPhoto ? <div className="figma-swipe-card-photo-empty" role={preview ? undefined : 'img'} aria-label={preview ? undefined : 'No verified photo is available'}>Photo unavailable</div> : null}
      </div>
      <div className="figma-swipe-card-meta"><span>{categoryLabel(item.category)}</span>{item.distanceLabel ? <span>{item.distanceLabel}</span> : null}</div>
      <div className="figma-swipe-card-copy"><h1>{item.title}</h1><p>{addressLabel(item)}</p></div>
      {!preview ? <><strong className="figma-swipe-drag-label is-pass" style={{ opacity: Math.max(0, -dragX / 90) }}>PASS</strong><strong className="figma-swipe-drag-label is-save" style={{ opacity: Math.max(0, dragX / 90) }}>SAVE</strong></> : null}
      {!preview ? <button className="figma-swipe-details-button" type="button" aria-label="Open details" onClick={() => setDetailsOpen(true)} disabled={busy}>+</button> : null}
    </article>
    {!preview && detailsOpen ? <DetailsDialog item={item} photoUrls={photoUrls} busy={busy} onChoice={async (action) => { setDetailsOpen(false); await choose(action) }} onClose={() => setDetailsOpen(false)} /> : null}
  </>
}