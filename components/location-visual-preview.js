"use client"

import { useEffect, useState } from 'react'
import { SwipeMapPreview } from '@/components/swipe-map-preview'

const LOCATION_VISUAL_CACHE_KEY = 'puddle:location-visual-coordinates:v2'
const LOCATION_VISUAL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const LOCATION_VISUAL_CACHE_LIMIT = 300

function hasCoordinateValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function validCoordinates(latitude, longitude) {
  if (!hasCoordinateValue(latitude) || !hasCoordinateValue(longitude)) return null
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { latitude: lat, longitude: lon }
}

function readCoordinateCache(slug) {
  if (typeof window === 'undefined' || !slug) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCATION_VISUAL_CACHE_KEY) || '{}')
    const entry = parsed?.entries?.[slug]
    if (!entry?.cachedAt || Date.now() - entry.cachedAt > LOCATION_VISUAL_CACHE_TTL_MS) return null
    return validCoordinates(entry.latitude, entry.longitude)
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

const frameStyle = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  background: '#f0f0f0',
  color: '#858585',
  font: '700 13px/1.2 Manrope, sans-serif'
}

const imageStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover'
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

  return <span className={className} style={frameStyle} data-location-visual={image ? 'photo' : coordinates ? 'map' : 'fallback'}>
    {image
      ? <img className={imageClassName || undefined} style={imageStyle} src={image} alt={`${title} photo`} loading="lazy" decoding="async" />
      : coordinates
        ? <SwipeMapPreview latitude={coordinates.latitude} longitude={coordinates.longitude} title={title} />
        : <span className="location-visual-fallback" aria-hidden="true">Puddle</span>}
  </span>
}
