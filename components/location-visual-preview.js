"use client"

import { useEffect, useState } from 'react'
import { SwipeMapPreview } from '@/components/swipe-map-preview'

const LOCATION_VISUAL_CACHE_KEY = 'puddle:location-visual-coordinates:v1'
const LOCATION_VISUAL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LOCATION_VISUAL_CACHE_LIMIT = 300

function readCoordinateCache(slug) {
  if (typeof window === 'undefined' || !slug) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCATION_VISUAL_CACHE_KEY) || '{}')
    const entry = parsed?.entries?.[slug]
    if (!entry?.cachedAt || Date.now() - entry.cachedAt > LOCATION_VISUAL_CACHE_TTL_MS) return null
    const latitude = Number(entry.latitude)
    const longitude = Number(entry.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null
  } catch {
    return null
  }
}

function writeCoordinateCache(slug, coordinates) {
  if (typeof window === 'undefined' || !slug || !coordinates) return
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCATION_VISUAL_CACHE_KEY) || '{}')
    const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    entries[slug] = { ...coordinates, cachedAt: Date.now() }
    const limited = Object.fromEntries(
      Object.entries(entries)
        .sort(([, left], [, right]) => Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0))
        .slice(0, LOCATION_VISUAL_CACHE_LIMIT)
    )
    window.localStorage.setItem(LOCATION_VISUAL_CACHE_KEY, JSON.stringify({ entries: limited }))
  } catch {}
}

function validCoordinates(latitude, longitude) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon } : null
}

export function LocationVisualPreview({ slug, title, image = null, latitude = null, longitude = null, className = '', imageClassName = '' }) {
  const directCoordinates = validCoordinates(latitude, longitude)
  const [coordinates, setCoordinates] = useState(directCoordinates)

  useEffect(() => {
    if (image) return undefined
    if (directCoordinates) {
      setCoordinates(directCoordinates)
      if (slug) writeCoordinateCache(slug, directCoordinates)
      return undefined
    }
    if (!slug) return undefined

    const cached = readCoordinateCache(slug)
    if (cached) {
      setCoordinates(cached)
      return undefined
    }

    const controller = new AbortController()
    fetch(`/api/saved-location/${encodeURIComponent(slug)}`, { cache: 'force-cache', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (controller.signal.aborted) return
        const next = validCoordinates(payload?.location?.latitude, payload?.location?.longitude)
        if (!next) return
        setCoordinates(next)
        writeCoordinateCache(slug, next)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [directCoordinates?.latitude, directCoordinates?.longitude, image, slug])

  return <span className={className} data-location-visual={image ? 'photo' : coordinates ? 'map' : 'fallback'}>
    {image
      ? <img className={imageClassName || undefined} src={image} alt={`${title} photo`} loading="lazy" decoding="async" />
      : coordinates
        ? <SwipeMapPreview latitude={coordinates.latitude} longitude={coordinates.longitude} title={title} />
        : <span className="location-visual-fallback" aria-hidden="true">Puddle</span>}
  </span>
}
