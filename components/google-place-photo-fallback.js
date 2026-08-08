"use client"

import { useEffect, useRef, useState } from 'react'
import { findGoogleUiKitPlace } from '@/lib/app/google-place-client'

let placesLibraryPromise = null

function googleUiEnabled() {
  return process.env.NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_ENABLED !== 'false'
}

function installLoader(apiKey) {
  if (window.google?.maps?.importLibrary) return
  window.google = window.google || {}
  window.google.maps = window.google.maps || {}
  const maps = window.google.maps
  const requestedLibraries = new Set()
  maps.importLibrary = (library) => {
    requestedLibraries.add(library)
    if (!placesLibraryPromise) {
      placesLibraryPromise = new Promise((resolve, reject) => {
        const callback = '__puddleGoogleMapsReady'
        const parameters = new URLSearchParams({
          key: apiKey,
          v: 'weekly',
          loading: 'async',
          libraries: [...requestedLibraries].join(','),
          callback: `google.maps.${callback}`
        })
        const script = document.createElement('script')
        script.src = `https://maps.googleapis.com/maps/api/js?${parameters}`
        script.async = true
        script.dataset.puddleGoogleMaps = 'true'
        script.nonce = document.querySelector('script[nonce]')?.nonce || ''
        script.onerror = () => reject(new Error('Google Maps JavaScript could not load.'))
        maps[callback] = resolve
        document.head.append(script)
      })
    }
    return placesLibraryPromise.then(() => window.google.maps.importLibrary(library))
  }
}

async function loadPlacesLibrary(apiKey) {
  installLoader(apiKey)
  const places = await window.google.maps.importLibrary('places')
  await Promise.all([
    customElements.whenDefined('gmp-place-details-compact'),
    customElements.whenDefined('gmp-place-details-place-request'),
    customElements.whenDefined('gmp-place-content-config'),
    customElements.whenDefined('gmp-place-media'),
    customElements.whenDefined('gmp-place-attribution'),
    customElements.whenDefined('gmp-place-search'),
    customElements.whenDefined('gmp-place-text-search-request'),
    customElements.whenDefined('gmp-place-all-content')
  ])
  return places
}

function fallbackLabel(state, title) {
  if (state === 'loading') return `Loading a Google Maps photo for ${title}`
  return `No live Google Maps photo is available for ${title}`
}

export function GooglePlacePhotoFallback({ title, placeId, lookup = null, placeholderUrl = null }) {
  const mountRef = useRef(null)
  const [state, setState] = useState('loading')
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const lookupKey = [
    lookup?.allowed,
    lookup?.name,
    lookup?.city,
    lookup?.region,
    lookup?.country,
    lookup?.countryCode,
    lookup?.addressPublic,
    lookup?.latitude,
    lookup?.longitude,
    lookup?.minimumScore
  ].join('|')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !apiKey || !googleUiEnabled() || (!placeId && !lookup?.allowed)) {
      setState('unavailable')
      return undefined
    }

    let cancelled = false
    let details = null
    const fail = () => { if (!cancelled) setState('unavailable') }

    async function render() {
      try {
        await loadPlacesLibrary(apiKey)
        if (cancelled) return
        const resolvedPlaceId = placeId
          ? String(placeId)
          : (await findGoogleUiKitPlace(mount, lookup))?.placeId || null
        if (!resolvedPlaceId || cancelled) {
          fail()
          return
        }

        details = document.createElement('gmp-place-details-compact')
        details.className = 'date-google-place-details'
        details.setAttribute('orientation', 'vertical')
        details.setAttribute('truncation-preferred', '')
        details.setAttribute('aria-label', `Google Maps place photo for ${title}`)

        const request = document.createElement('gmp-place-details-place-request')
        request.setAttribute('place', resolvedPlaceId)
        const content = document.createElement('gmp-place-content-config')
        const media = document.createElement('gmp-place-media')
        media.setAttribute('lightbox-preferred', '')
        const attribution = document.createElement('gmp-place-attribution')
        attribution.setAttribute('light-scheme-color', 'black')
        attribution.setAttribute('dark-scheme-color', 'white')
        content.append(media, attribution)
        details.append(request, content)
        details.addEventListener('gmp-load', () => { if (!cancelled) setState('ready') }, { once: true })
        details.addEventListener('gmp-requesterror', fail)
        mount.replaceChildren(details)
      } catch {
        fail()
      }
    }

    setState('loading')
    render()
    return () => {
      cancelled = true
      if (details) details.removeEventListener('gmp-requesterror', fail)
      mount.replaceChildren()
    }
  }, [apiKey, placeId, title, lookupKey])

  return (
    <div
      className={`date-google-photo ${state === 'ready' ? 'is-ready' : ''}`}
      aria-label={fallbackLabel(state, title)}
      style={placeholderUrl ? { backgroundImage: `url(${placeholderUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      <div ref={mountRef} className="date-google-photo-mount" />
      {state === 'loading' ? <div className="date-google-photo-status"><span aria-hidden="true">⌖</span><small>Loading a Google Maps photo…</small></div> : null}
      {state === 'unavailable' ? <div className="date-card-placeholder"><span aria-hidden="true">⌖</span><small>Real photo coming soon</small></div> : null}
    </div>
  )
}
