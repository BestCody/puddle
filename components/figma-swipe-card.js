"use client"

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'
import { GoogleServerPlacePhoto } from '@/components/google-server-place-photo'

const labels = {
  cafe: 'Coffee', restaurant: 'Restaurant', bar: 'Bar', park: 'Park', museum: 'Museum',
  gallery: 'Gallery', attraction: 'Attraction', activity_venue: 'Activity', study_spot: 'Study',
  scenic_spot: 'Scenic', nightlife: 'Nightlife', shop: 'Shop', community_space: 'Community'
}

const OPTIMIZED_IMAGE_HOSTS = new Set(['cegoqtvajwajczbofpep.supabase.co'])

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

function canOptimizeImage(url) {
  if (!url) return false
  const value = String(url)
  if (value.startsWith('/')) return true
  try { return OPTIMIZED_IMAGE_HOSTS.has(new URL(value).hostname) } catch { return false }
}

function DetailsPhoto({ url, title, index }) {
  const alt = index ? `${title} photo ${index + 1}` : title
  if (canOptimizeImage(url)) {
    return <Image src={url} alt={alt} width={420} height={260} sizes="(max-width: 760px) 50vw, 310px" />
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" />
}

function DetailsDialog({ item, photoUrls, onChoice, busy, onClose }) {
  const close = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    close.current?.focus()
    function keydown(event) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown); previous?.focus?.() }
  }, [onClose])

  return <div className="figma-swipe-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="figma-swipe-details" role="dialog" aria-modal="true" aria-label={`Full details for ${item.title}`}>
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

export function FigmaSwipeCard({ item, onChoice, busy, actionRequest }) {
  const pointerId = useRef(null)
  const originX = useRef(0)
  const choiceInFlight = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const photoUrls = useMemo(() => photos(item), [item])
  const mainPhoto = photoUrls[0] || null
  const optimizedMainPhoto = mainPhoto && canOptimizeImage(mainPhoto) ? mainPhoto : null
  const placeholder = item.category_placeholder_url || null
  const googleServerUrl = !mainPhoto ? item.google_photo_proxy_url : null
  const googleLookup = useMemo(() => !mainPhoto && !googleServerUrl && item.google_client_lookup ? {
    allowed: true,
    name: item.title || item.name,
    city: item.city,
    region: item.region,
    country: item.country,
    countryCode: item.country_code || item.countryCode,
    addressPublic: item.address_public || item.addressPublic,
    latitude: item.latitude,
    longitude: item.longitude,
    minimumScore: item.google_lookup_min_score
  } : null, [item, mainPhoto, googleServerUrl])

  async function choose(action) {
    if (busy || choiceInFlight.current) return
    choiceInFlight.current = true
    setDragging(false)
    setDragX(action === 'pass' ? -720 : action === 'save' ? 720 : 0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 0 : action === 'save' ? 420 : action === 'pass' ? 260 : 0
    try {
      if (duration) await new Promise((resolve) => window.setTimeout(resolve, duration))
      await onChoice(action, item)
    } finally {
      setDragX(0)
      choiceInFlight.current = false
    }
  }

  useEffect(() => {
    if (actionRequest?.id) choose(actionRequest.action)
  }, [actionRequest?.id])

  function pointerDown(event) {
    if (busy || event.target.closest('button,a')) return
    pointerId.current = event.pointerId
    originX.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function pointerMove(event) {
    if (!dragging || pointerId.current !== event.pointerId) return
    setDragX(Math.max(-180, Math.min(180, event.clientX - originX.current)))
  }
  function pointerUp(event) {
    if (pointerId.current !== event.pointerId) return
    const delta = event.clientX - originX.current
    pointerId.current = null
    setDragging(false)
    if (delta <= -90) choose('pass')
    else if (delta >= 90) choose('save')
    else setDragX(0)
  }

  const photoStyle = !optimizedMainPhoto && (mainPhoto || placeholder) ? { backgroundImage: `url(${mainPhoto || placeholder})` } : undefined

  return <>
    <article
      className={`figma-swipe-card${dragging ? ' is-dragging' : ''}`}
      style={{ transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)` }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') choose('pass')
        if (event.key === 'ArrowRight') choose('save')
        if (event.key === 'Enter' || event.key === 'ArrowUp') setDetailsOpen(true)
      }}
      aria-label={`${item.title}. Swipe left to pass, right to save, or press Enter for details.`}
    >
      <div className="figma-swipe-card-photo" style={photoStyle}>
        {optimizedMainPhoto ? <Image src={optimizedMainPhoto} alt={item.title} fill sizes="(max-width: 760px) 320px, 400px" preload /> : null}
        {!mainPhoto && googleServerUrl ? <GoogleServerPlacePhoto title={item.title} url={googleServerUrl} placeholderUrl={placeholder} /> : null}
        {!mainPhoto && !googleServerUrl && googleLookup ? <GooglePlacePhotoFallback title={item.title} placeId={null} lookup={googleLookup} placeholderUrl={placeholder} /> : null}
      </div>
      <div className="figma-swipe-card-meta"><span>{categoryLabel(item.category)}</span>{item.distanceLabel ? <span>{item.distanceLabel}</span> : null}</div>
      <div className="figma-swipe-card-copy"><h1>{item.title}</h1><p>{addressLabel(item)}</p></div>
      <strong className="figma-swipe-drag-label is-pass" style={{ opacity: Math.max(0, -dragX / 90) }}>PASS</strong>
      <strong className="figma-swipe-drag-label is-save" style={{ opacity: Math.max(0, dragX / 90) }}>SAVE</strong>
      <button className="figma-swipe-details-button" type="button" aria-label="Open details" onClick={() => setDetailsOpen(true)} disabled={busy}>+</button>
    </article>
    {detailsOpen ? <DetailsDialog item={item} photoUrls={photoUrls} busy={busy} onChoice={async (action) => { setDetailsOpen(false); await choose(action) }} onClose={() => setDetailsOpen(false)} /> : null}
  </>
}
