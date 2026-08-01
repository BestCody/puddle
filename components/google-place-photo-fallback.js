"use client"

import { useEffect, useRef, useState } from 'react'

let googleLoaderPromise = null

function installGoogleLoader(apiKey) {
  if (window.google?.maps?.importLibrary) return
  window.google = window.google || {}
  window.google.maps = window.google.maps || {}
  const maps = window.google.maps
  const libraries = new Set()

  maps.importLibrary = (library) => {
    libraries.add(library)
    if (!googleLoaderPromise) {
      googleLoaderPromise = new Promise((resolve, reject) => {
        const callbackName = '__puddleGoogleMapsReady'
        const params = new URLSearchParams({
          key: apiKey,
          v: 'weekly',
          loading: 'async',
          libraries: [...libraries].join(','),
          callback: `google.maps.${callbackName}`
        })
        const script = document.createElement('script')
        script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
        script.async = true
        script.dataset.puddleGoogleMaps = 'true'
        script.nonce = document.querySelector('script[nonce]')?.nonce || ''
        script.onerror = () => reject(new Error('Google Maps could not load.'))
        maps[callbackName] = resolve
        document.head.append(script)
      })
    }
    return googleLoaderPromise.then(() => window.google.maps.importLibrary(library))
  }
}

async function loadPlacesLibrary(apiKey) {
  installGoogleLoader(apiKey)
  await window.google.maps.importLibrary('places')
  await Promise.all([
    customElements.whenDefined('gmp-place-details-compact'),
    customElements.whenDefined('gmp-place-details-place-request')
  ])
}

async function resolvePlaceId(locationId, existingPlaceId) {
  if (existingPlaceId) return String(existingPlaceId)
  if (!locationId) return null
  const response = await fetch(`/api/location-google-place/${encodeURIComponent(String(locationId))}`, { cache: 'no-store' })
  if (!response.ok) return null
  const result = await response.json().catch(() => ({}))
  return result.placeId ? String(result.placeId) : null
}

export function GooglePlacePhotoFallback({ title, locationId, placeId = null, apiKey = '' }) {
  const rootRef = useRef(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    const root = rootRef.current
    if (!root || !apiKey || (!placeId && !locationId)) {
      setState('unavailable')
      return undefined
    }

    let cancelled = false
    let details = null
    const fail = () => {
      if (!cancelled) setState('unavailable')
    }

    async function render() {
      try {
        const verifiedPlaceId = await resolvePlaceId(locationId, placeId)
        if (!verifiedPlaceId || cancelled) return fail()
        await loadPlacesLibrary(apiKey)
        if (cancelled) return

        details = document.createElement('gmp-place-details-compact')
        details.className = 'date-google-place-details'
        details.setAttribute('orientation', 'vertical')
        details.setAttribute('truncation-preferred', '')
        details.setAttribute('aria-label', `Google Maps place photo for ${title}`)

        const request = document.createElement('gmp-place-details-place-request')
        request.setAttribute('place', verifiedPlaceId)
        const content = document.createElement('gmp-place-content-config')
        const media = document.createElement('gmp-place-media')
        const attribution = document.createElement('gmp-place-attribution')
        attribution.setAttribute('light-scheme-color', 'black')
        attribution.setAttribute('dark-scheme-color', 'white')
        content.append(media, attribution)
        details.append(request, content)

        details.addEventListener('gmp-load', () => { if (!cancelled) setState('ready') }, { once: true })
        details.addEventListener('gmp-requesterror', fail)
        root.replaceChildren(details)
      } catch {
        fail()
      }
    }

    setState('loading')
    render()
    return () => {
      cancelled = true
      if (details) details.removeEventListener('gmp-requesterror', fail)
      root.replaceChildren()
    }
  }, [apiKey, locationId, placeId, title])

  return (
    <div className={`date-google-photo ${state === 'ready' ? 'is-ready' : ''}`}>
      <div ref={rootRef} className="date-google-photo-mount" />
      {state === 'loading' ? <div className="date-google-photo-status"><span>⌖</span><small>Loading a Google Maps photo…</small></div> : null}
      {state === 'unavailable' ? <div className="date-card-placeholder"><span>⌖</span><small>Real photo coming soon</small></div> : null}
    </div>
  )
}
