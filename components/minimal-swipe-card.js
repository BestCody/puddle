"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'
import { GoogleServerPlacePhoto } from '@/components/google-server-place-photo'
import { photoDisplayState } from '@/lib/app/photo-enrichment'
import { usePrivateB2Asset } from '@/lib/app/use-private-b2-asset'
import { useStaticCatalogueDetails } from '@/lib/app/use-static-catalogue-details'
import { useStaticMediaResolution } from '@/lib/app/use-static-media-resolution'

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

function directionsUrl(item) {
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}

function openingRows(hours) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return []
  return Object.entries(hours).filter(([, value]) => value).slice(0, 7)
}

function todayHoursLabel(hours) {
  const rows = openingRows(hours)
  if (!rows.length) return null
  const today = new Intl.DateTimeFormat('en-CA', { weekday: 'long' }).format(new Date()).toLowerCase()
  const match = rows.find(([day]) => {
    const normalized = String(day).trim().toLowerCase()
    return normalized === today || normalized.slice(0, 3) === today.slice(0, 3)
  })
  return match ? String(match[1]) : null
}

function usefulSummary(item) {
  const summary = String(item.summary || '').trim()
  if (!summary) return null
  if (item.description_source === 'generated_factual') return null
  if (/details have not yet been verified\.?$/i.test(summary)) return null
  return summary
}

function locationLabel(item) {
  return item.address_public || item.addressPublic || [item.neighborhood, item.city, item.region].filter(Boolean).join(', ') || null
}

function photoCandidates(item) {
  const keys = item.private_b2_asset_keys || {}
  const candidates = [
    ...(item.photo_urls || []).map((url, index) => ({ url, key: keys.gallery?.[index] || null })),
    { url: item.photo_url, key: keys.photo || null },
    { url: item.cover_url, key: keys.cover || null }
  ]
  const seen = new Set()
  return candidates.filter(({ url }) => {
    if (!url || seen.has(url)) return false
    seen.add(url)
    return true
  }).slice(0, 5)
}

function PrivateDetailPhoto({ photo, title, index }) {
  const resolved = usePrivateB2Asset(photo?.url || null, photo?.key || null)
  if (!resolved) return null
  return <img src={resolved} alt={index === 0 ? title : `${title} photo ${index + 1}`} />
}

function DetailsSheet({ item, photos, busy, onChoice, onClose }) {
  const closeButton = useRef(null)
  const directionsHref = directionsUrl(item)
  const hours = openingRows(item.opening_hours)
  const todayHours = todayHoursLabel(item.opening_hours)
  const summary = usefulSummary(item)
  const place = locationLabel(item)
  const rating = ratingLabel(item)
  const amenities = (item.amenities || []).slice(0, 8)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    function keydown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', keydown)
      previousFocus?.focus?.()
    }
  }, [onClose])

  return (
    <div className="minimal-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="minimal-details-sheet" role="dialog" aria-modal="true" aria-label={`Full details for ${item.title}`} onKeyDown={(event) => event.stopPropagation()}>
        <button ref={closeButton} className="minimal-details-close" type="button" onClick={onClose} aria-label="Close details">×</button>
        <div className="minimal-details-scroll">
          {photos.length ? <div className="minimal-details-gallery" aria-label={`${item.title} photos`}>{photos.map((photo, index) => <PrivateDetailPhoto photo={photo} title={item.title} index={index} key={`${photo.url}:${index}`} />)}</div> : null}
          <div className="minimal-details-copy">
            <header className="minimal-details-heading">
              <span>{categoryLabel(item.category)}</span>
              <h2 id="minimal-details-title">{item.title}</h2>
              <div className="minimal-details-subline">
                {item.distanceLabel ? <span>{item.distanceLabel}</span> : null}
                {place ? <span>{place}</span> : null}
              </div>
            </header>

            <div className="minimal-details-facts" aria-label="Quick facts">
              {rating ? <span>{rating}</span> : null}
              {item.priceLabel && item.priceLabel !== 'Price varies' ? <span>{item.priceLabel}</span> : null}
              {item.open_now ? <span className="is-open">Open now</span> : hours.length ? <span>Check hours</span> : null}
              {todayHours ? <span>Today · {todayHours}</span> : null}
            </div>

            {summary ? <section className="minimal-detail-section">
              <h3>Why go</h3>
              <p>{summary}</p>
            </section> : null}

            {amenities.length ? <section className="minimal-detail-section">
              <h3>Good to know</h3>
              <div className="minimal-amenities">{amenities.map((value) => <span key={value}>{String(value).replaceAll('_', ' ')}</span>)}</div>
            </section> : null}

            {hours.length ? <section className="minimal-detail-section minimal-details-hours-section">
              <div className="minimal-detail-section-heading">
                <h3>Hours</h3>
                {todayHours ? <strong>Today · {todayHours}</strong> : null}
              </div>
              <details className="minimal-hours">
                <summary>View all hours</summary>
                {hours.map(([day, value]) => <div key={day}><span>{day}</span><strong>{String(value)}</strong></div>)}
              </details>
            </section> : null}

            {place || directionsHref ? <section className="minimal-detail-section minimal-details-location">
              <div>
                <h3>Location</h3>
                {place ? <p>{place}</p> : null}
              </div>
              {directionsHref ? <a href={directionsHref} target="_blank" rel="noreferrer">Directions</a> : null}
            </section> : null}
          </div>
        </div>

        <footer className="minimal-details-decision-bar" aria-label="Choose this place">
          <button className="is-pass" type="button" onClick={() => onChoice('pass')} disabled={busy}>Pass</button>
          <button className="is-save" type="button" onClick={() => onChoice('save')} disabled={busy}>Save</button>
          <button className="is-perfect" type="button" onClick={() => onChoice('perfect')} disabled={busy}>★ Perfect Pick</button>
        </footer>
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

export function MinimalSwipeCard({ item: sourceItem, onChoice, busy }) {
  const item = useStaticMediaResolution(sourceItem)
  const pointer = useRef(null)
  const origin = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailItem = useStaticCatalogueDetails(item, detailsOpen)
  const candidates = useMemo(() => photoCandidates(item), [item])
  const rawMainPhoto = candidates[0]?.url || null
  const privateMainKey = candidates[0]?.key || null
  const mainPhoto = usePrivateB2Asset(rawMainPhoto, privateMainKey)
  const mainPhotoPending = Boolean(rawMainPhoto && privateMainKey && !mainPhoto)
  const placeholderUrl = usePrivateB2Asset(
    item.category_placeholder_url || null,
    item.private_b2_asset_keys?.placeholder || null
  )
  const photos = candidates
  const googleLookup = useMemo(() => item.google_client_lookup ? {
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
  } : null, [
    item.google_client_lookup,
    item.google_lookup_min_score,
    item.title,
    item.name,
    item.city,
    item.region,
    item.country,
    item.country_code,
    item.countryCode,
    item.address_public,
    item.addressPublic,
    item.latitude,
    item.longitude
  ])
  const googleServerPhotoUrl = item.google_photo_proxy_url || null
  const useGoogleServerPhoto = !mainPhoto && !mainPhotoPending && Boolean(googleServerPhotoUrl)
  const useGoogleUiKit = !useGoogleServerPhoto && !mainPhoto && !mainPhotoPending && Boolean(item.google_place_id || googleLookup)
  const [photoStatus, setPhotoStatus] = useState(item.photo_enrichment_status || (rawMainPhoto ? 'matched' : 'pending'))
  const displayState = photoDisplayState(photoStatus, Boolean(mainPhoto))
  const rating = ratingLabel(item)

  useEffect(() => {
    const nextStatus = item.photo_enrichment_status || (rawMainPhoto ? 'matched' : 'pending')
    setPhotoStatus(nextStatus)
    if (rawMainPhoto || item.static_catalogue_ephemeral || !item.content_id || !['pending', 'processing', 'failed'].includes(nextStatus)) return undefined
    let cancelled = false
    fetch(`/api/location-photo-status/${encodeURIComponent(item.content_id)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (!cancelled && result?.status) setPhotoStatus(result.status) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [item.content_id, item.photo_enrichment_status, item.static_catalogue_ephemeral, rawMainPhoto])

  async function choose(action) {
    if (busy) return
    setDragging(false)
    setDragX(action === 'pass' ? -720 : 720)
    await new Promise((resolve) => window.setTimeout(resolve, 160))
    await onChoice(action, item)
    setDragX(0)
  }

  async function chooseFromDetails(action) {
    if (busy) return
    setDetailsOpen(false)
    await choose(action)
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
        if (detailsOpen) return
        if (event.key === 'ArrowLeft') choose('pass')
        if (event.key === 'ArrowRight') choose('save')
        if (event.key === 'Enter' || event.key === 'ArrowUp') setDetailsOpen(true)
      }}
      aria-label={`${item.title}. Swipe left to pass, right to save, or press Enter for details.`}
    >
      <div className={`minimal-swipe-photo ${useGoogleServerPhoto || useGoogleUiKit ? 'has-google-fallback' : ''}`} style={photoStyle}>
        {useGoogleServerPhoto
          ? <GoogleServerPlacePhoto title={item.title} url={googleServerPhotoUrl} placeholderUrl={placeholderUrl} />
          : useGoogleUiKit ? <GooglePlacePhotoFallback title={item.title} placeId={item.google_place_id} lookup={googleLookup} placeholderUrl={placeholderUrl} /> : null}
        {!useGoogleServerPhoto && !useGoogleUiKit && !mainPhotoPending && displayState === 'unavailable' ? <div className="minimal-photo-placeholder" aria-label="No usable open photo was found" style={placeholderUrl ? { backgroundImage: `url(${placeholderUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}><span aria-hidden="true">⌖</span><small style={{ position: 'absolute', bottom: 28, fontSize: '.82rem' }}>Real photo coming soon</small></div> : null}
        {!useGoogleServerPhoto && !useGoogleUiKit && !mainPhotoPending && (displayState === 'searching' || displayState === 'retrying') ? <PhotoSearchState state={displayState} placeholderUrl={placeholderUrl} /> : null}
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
    {detailsOpen ? <DetailsSheet item={detailItem} photos={photos} busy={busy} onChoice={chooseFromDetails} onClose={() => setDetailsOpen(false)} /> : null}
  </>
}
