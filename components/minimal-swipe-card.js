"use client"

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'
import { photoDisplayState } from '@/lib/app/photo-enrichment'

const categoryLabels = {
  cafe: 'Coffee shop', restaurant: 'Restaurant', bar: 'Bar or lounge', park: 'Park or garden',
  museum: 'Museum', gallery: 'Gallery', attraction: 'Attraction', activity_venue: 'Activity',
  study_spot: 'Quiet spot', scenic_spot: 'Scenic spot', nightlife: 'Nightlife', shop: 'Shop',
  community_space: 'Community space', other: 'Place'
}

function categoryLabel(value) {
  return categoryLabels[value] || String(value || 'Place').replaceAll('_', ' ')
}

function ratingLabel(item) {
  const count = Number(item.rating_count || 0)
  const rating = Number(item.average_rating || item.confidence_adjusted_rating || 0)
  return count > 0 && rating > 0 ? `${rating.toFixed(1)} ★` : null
}

function mapUrl(item) {
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
}

function openingRows(hours) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return []
  return Object.entries(hours).filter(([, value]) => value).slice(0, 7)
}

function DetailsSheet({ item, photos, onClose }) {
  const mapHref = mapUrl(item)
  const hours = openingRows(item.opening_hours)
  return (
    <div className="minimal-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="minimal-details-sheet" role="dialog" aria-modal="true" aria-labelledby="minimal-details-title">
        <button className="minimal-details-close" type="button" onClick={onClose} aria-label="Close details">×</button>
        {photos.length ? <div className="minimal-details-gallery">{photos.map((photo, index) => <img src={photo} alt={index === 0 ? item.title : `${item.title} photo ${index + 1}`} key={photo} />)}</div> : null}
        <div className="minimal-details-copy">
          <span>{categoryLabel(item.category)}</span>
          <h2 id="minimal-details-title">{item.title}</h2>
          <p>{item.summary || 'A nearby place worth considering.'}</p>
          <div className="minimal-details-facts">
            {item.distanceLabel ? <span>{item.distanceLabel}</span> : null}
            {ratingLabel(item) ? <span>{ratingLabel(item)}</span> : null}
            {item.priceLabel && item.priceLabel !== 'Price varies' ? <span>{item.priceLabel}</span> : null}
            <span>{item.open_now ? 'Open now' : 'Check hours'}</span>
          </div>
          {item.neighborhood || item.city ? <p className="minimal-address">{[item.neighborhood, item.city].filter(Boolean).join(', ')}</p> : null}
          {(item.amenities || []).length ? <div className="minimal-amenities">{item.amenities.slice(0, 8).map((value) => <span key={value}>{String(value).replaceAll('_', ' ')}</span>)}</div> : null}
          {hours.length ? <details className="minimal-hours"><summary>Opening hours</summary>{hours.map(([day, value]) => <div key={day}><span>{day}</span><strong>{String(value)}</strong></div>)}</details> : null}
          <div className="minimal-details-actions">
            {mapHref ? <a href={mapHref} target="_blank" rel="noreferrer">Map</a> : null}
            <Link href={item.href} prefetch={false}>Full details</Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function PhotoSearchState({ state, placeholderUrl }) {
  const retrying = state === 'retrying'
  return <div
    aria-live="polite"
    style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10,
      padding: 24, textAlign: 'center', color: '#756c70',
      background: placeholderUrl ? `linear-gradient(rgba(238,233,235,.84),rgba(221,214,217,.84)),url(${placeholderUrl}) center/cover` : 'linear-gradient(145deg,#eee9eb,#ddd6d9)'
    }}
  >
    <span aria-hidden="true" style={{ fontSize: '2.3rem' }}>⌖</span>
    <strong style={{ fontSize: '.9rem' }}>{retrying ? 'Photo search will retry' : 'Finding a real photo'}</strong>
    <small style={{ maxWidth: 250, lineHeight: 1.4 }}>Checking Wikimedia Commons, Mapillary, and KartaView.</small>
  </div>
}

export function MinimalSwipeCard({ item, onChoice, busy }) {
  const pointer = useRef(null)
  const origin = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const photos = useMemo(() => [...new Set([...(item.photo_urls || []), item.photo_url, item.cover_url].filter(Boolean))].slice(0, 5), [item])
  const mainPhoto = photos[0] || null
  const useGoogleUiKit = !mainPhoto && Boolean(item.google_place_id)
  const placeholderUrl = item.category_placeholder_url || null
  const [photoStatus, setPhotoStatus] = useState(item.photo_enrichment_status || (mainPhoto ? 'matched' : 'pending'))
  const displayState = photoDisplayState(photoStatus, Boolean(mainPhoto))
  const rating = ratingLabel(item)

  useEffect(() => {
    const nextStatus = item.photo_enrichment_status || (mainPhoto ? 'matched' : 'pending')
    setPhotoStatus(nextStatus)
    if (mainPhoto || item.static_catalogue_ephemeral || !item.content_id || !['pending', 'processing', 'failed'].includes(nextStatus)) return undefined
    let cancelled = false
    fetch(`/api/location-photo-status/${encodeURIComponent(item.content_id)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (!cancelled && result?.status) setPhotoStatus(result.status) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [item.content_id, item.photo_enrichment_status, item.static_catalogue_ephemeral, mainPhoto])

  async function choose(action) {
    if (busy) return
    setDragging(false)
    setDragX(action === 'pass' ? -720 : 720)
    await new Promise((resolve) => window.setTimeout(resolve, 160))
    await onChoice(action, item)
    setDragX(0)
  }

  function pointerDown(event) {
    if (busy || event.target.closest('button,a')) return
    pointer.current = event.pointerId
    origin.current = { x: event.clientX, y: event.clientY }
    moved.current = false
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function pointerMove(event) {
    if (!dragging || pointer.current !== event.pointerId) return
    const next = event.clientX - origin.current.x
    if (Math.abs(next) > 6) moved.current = true
    setDragX(Math.max(-180, Math.min(180, next)))
  }

  function pointerUp(event) {
    if (pointer.current !== event.pointerId) return
    const finalX = event.clientX - origin.current.x
    pointer.current = null
    setDragging(false)
    if (finalX <= -90) choose('pass')
    else if (finalX >= 90) choose('save')
    else {
      setDragX(0)
      if (!moved.current) setDetailsOpen(true)
    }
  }

  const photoStyle = mainPhoto
    ? { backgroundImage: `linear-gradient(180deg,transparent 45%,rgba(10,10,12,.82)),url(${mainPhoto})` }
    : placeholderUrl
      ? { backgroundImage: `linear-gradient(180deg,transparent 45%,rgba(10,10,12,.62)),url(${placeholderUrl})` }
      : undefined

  return <>
    <article
      className={`minimal-swipe-card ${dragging ? 'is-dragging' : ''}`}
      style={{ transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)` }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      tabIndex="0"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') choose('pass')
        if (event.key === 'ArrowRight') choose('save')
        if (event.key === 'Enter' || event.key === 'ArrowUp') setDetailsOpen(true)
      }}
      aria-label={`${item.title}. Swipe left to pass, right to save, or press Enter for details.`}
    >
      <div className={`minimal-swipe-photo ${useGoogleUiKit ? 'has-google-fallback' : ''}`} style={photoStyle}>
        {useGoogleUiKit ? <GooglePlacePhotoFallback title={item.title} placeId={item.google_place_id} placeholderUrl={placeholderUrl} /> : null}
        {!useGoogleUiKit && displayState === 'unavailable' ? <div className="minimal-photo-placeholder" aria-label="No usable open photo was found" style={placeholderUrl ? { backgroundImage: `url(${placeholderUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span aria-hidden="true">⌖</span><small style={{ position: 'absolute', bottom: 28, fontSize: '.82rem' }}>Real photo coming soon</small></div> : null}
        {!useGoogleUiKit && (displayState === 'searching' || displayState === 'retrying') ? <PhotoSearchState state={displayState} placeholderUrl={placeholderUrl} /> : null}
        <div className="minimal-swipe-meta">
          <span>{categoryLabel(item.category)}</span>
          {item.distanceLabel ? <span>{item.distanceLabel}</span> : null}
        </div>
        <div className="minimal-swipe-title">
          <h1>{item.title}</h1>
          <div>
            {rating ? <span>{rating}</span> : null}
            {item.priceLabel && item.priceLabel !== 'Price varies' ? <span>{item.priceLabel}</span> : null}
          </div>
        </div>
        <strong className="minimal-swipe-pass" style={{ opacity: Math.max(0, -dragX / 90) }}>PASS</strong>
        <strong className="minimal-swipe-save" style={{ opacity: Math.max(0, dragX / 90) }}>SAVE</strong>
      </div>
    </article>
    {detailsOpen ? <DetailsSheet item={item} photos={photos} onClose={() => setDetailsOpen(false)} /> : null}
  </>
}
