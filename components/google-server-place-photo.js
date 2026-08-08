"use client"

import { useEffect, useState } from 'react'
import { GooglePlacePhotoFallback } from '@/components/google-place-photo-fallback'

function decodeHeader(value) {
  if (!value) return null
  try { return decodeURIComponent(value) } catch { return null }
}

function decodeAttributions(value) {
  const decoded = decodeHeader(value)
  if (!decoded) return []
  try {
    const parsed = JSON.parse(decoded)
    return Array.isArray(parsed) ? parsed.slice(0, 4) : []
  } catch {
    return []
  }
}

export function GoogleServerPlacePhoto({ title, url, placeId = null, lookup = null, placeholderUrl = null }) {
  const [photo, setPhoto] = useState({ state: 'loading', src: null, authors: [], googleMapsUri: null })

  useEffect(() => {
    if (!url) {
      setPhoto({ state: 'unavailable', src: null, authors: [], googleMapsUri: null })
      return undefined
    }

    let cancelled = false
    let objectUrl = null
    setPhoto({ state: 'loading', src: null, authors: [], googleMapsUri: null })

    fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Live Google photo returned ${response.status}.`)
        const contentType = String(response.headers.get('content-type') || '').toLowerCase()
        if (!contentType.startsWith('image/')) throw new Error('Live Google photo returned an invalid content type.')
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPhoto({
          state: 'ready',
          src: objectUrl,
          authors: decodeAttributions(response.headers.get('x-puddle-google-attributions')),
          googleMapsUri: decodeHeader(response.headers.get('x-puddle-google-maps-uri'))
        })
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[puddle-google-server-photo-error]', error?.message || String(error))
          setPhoto({ state: 'unavailable', src: null, authors: [], googleMapsUri: null })
        }
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (photo.state === 'unavailable' && (placeId || lookup?.allowed)) {
    return <GooglePlacePhotoFallback
      title={title}
      placeId={placeId}
      lookup={lookup}
      placeholderUrl={placeholderUrl}
    />
  }

  const ready = photo.state === 'ready' && photo.src
  const firstAuthor = photo.authors[0] || null
  const attributionStyle = {
    position: 'absolute', top: 12, right: 12, zIndex: 4, display: 'flex', alignItems: 'center', gap: 6,
    maxWidth: '78%', padding: '5px 8px', borderRadius: 8, background: 'rgba(255,255,255,.92)',
    color: '#3c4043', fontSize: 11, lineHeight: 1.15, boxShadow: '0 1px 4px rgba(0,0,0,.2)'
  }

  return <div
    className={`date-google-server-photo ${ready ? 'is-ready' : ''}`}
    aria-label={ready ? `Google Maps photo for ${title}` : `Loading a Google Maps photo for ${title}`}
    style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: placeholderUrl ? `url(${placeholderUrl}) center/cover` : undefined }}
  >
    {ready ? <img src={photo.src} alt={title} draggable="false" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
    {ready ? <div className="date-google-server-attribution" style={attributionStyle}>
      {firstAuthor?.photoUri ? <img src={firstAuthor.photoUri} alt="" aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} /> : null}
      <span style={{ display: 'inline-flex', gap: 4, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {photo.googleMapsUri
          ? <a href={photo.googleMapsUri} target="_blank" rel="noreferrer" translate="no" style={{ color: 'inherit', fontWeight: 600 }}>Google Maps</a>
          : <strong translate="no">Google Maps</strong>}
        {firstAuthor?.displayName ? <span aria-hidden="true">·</span> : null}
        {firstAuthor?.displayName && firstAuthor?.uri
          ? <a href={firstAuthor.uri} target="_blank" rel="noreferrer" style={{ color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstAuthor.displayName}</a>
          : firstAuthor?.displayName ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstAuthor.displayName}</span> : null}
      </span>
    </div> : null}
    {photo.state === 'loading' ? <div className="date-google-photo-status"><span aria-hidden="true">⌖</span><small>Loading a Google Maps photo…</small></div> : null}
    {photo.state === 'unavailable' ? <div className="date-card-placeholder"><span aria-hidden="true">⌖</span><small>Real photo coming soon</small></div> : null}
  </div>
}
