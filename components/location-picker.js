"use client"

import { useEffect, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

function initialLocation(profile = {}) {
  const latitude = Number(profile.latitude)
  const longitude = Number(profile.longitude)
  return {
    city: profile.city || '',
    region: profile.region || '',
    country: profile.country || '',
    countryCode: profile.country_code || '',
    latitude: Number.isFinite(latitude) ? latitude : '',
    longitude: Number.isFinite(longitude) ? longitude : '',
    timezone: profile.timezone || 'UTC',
    label: profile.location_label || [profile.city, profile.region, profile.country].filter(Boolean).join(', '),
    source: profile.location_source || (Number.isFinite(latitude) && Number.isFinite(longitude) ? 'legacy' : ''),
    accuracy: profile.location_accuracy_m ?? ''
  }
}

function emptyLocation() {
  return {
    city: '',
    region: '',
    country: '',
    countryCode: '',
    latitude: '',
    longitude: '',
    timezone: 'UTC',
    label: '',
    source: '',
    accuracy: ''
  }
}

function normalizedResult(result, source, accuracy = '') {
  return {
    city: result.city || '',
    region: result.region || '',
    country: result.country || '',
    countryCode: result.countryCode || '',
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone || 'UTC',
    label: result.label || [result.city, result.region, result.country].filter(Boolean).join(', '),
    source,
    accuracy
  }
}

export function LocationPicker({ profile = {}, error = '', onLocationChange }) {
  const [location, setLocation] = useState(() => initialLocation(profile))
  const [query, setQuery] = useState(location.label || location.city || '')
  const [results, setResults] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editedAfterError, setEditedAfterError] = useState(false)
  const visibleError = editedAfterError ? '' : error

  useEffect(() => {
    setEditedAfterError(false)
  }, [error])

  useEffect(() => {
    onLocationChange?.(location)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location])

  function editQuery(nextQuery) {
    const next = nextQuery.slice(0, 160)
    setQuery(next)
    setResults([])
    setMessage('')
    setEditedAfterError(true)
    if (next !== location.label) setLocation(emptyLocation())
  }

  async function search() {
    const value = query.trim()
    if (value.length < 2 || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/location/search?q=${encodeURIComponent(value)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'City search is unavailable.')
      setResults(payload.results || [])
      if (!(payload.results || []).length) setMessage('No matching cities found.')
    } catch (errorValue) {
      setMessage(errorValue.message || 'City search is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  function select(result) {
    const next = normalizedResult(result, 'city_search')
    setLocation(next)
    setQuery(next.label)
    setResults([])
    setEditedAfterError(true)
    setMessage('Location selected.')
  }

  function useCurrentLocation() {
    if (!navigator.geolocation || busy) {
      setMessage('Location access is not supported in this browser.')
      return
    }
    setBusy(true)
    setMessage('Requesting your location…')
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await csrfFetch('/api/location/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'We could not identify your location.')
        const next = normalizedResult(payload.result, 'browser', position.coords.accuracy)
        setLocation(next)
        setQuery(next.label)
        setResults([])
        setEditedAfterError(true)
        setMessage('Current location selected.')
      } catch (errorValue) {
        setMessage(errorValue.message || 'We could not identify your location.')
      } finally {
        setBusy(false)
      }
    }, (locationError) => {
      setBusy(false)
      setMessage(locationError.code === 1 ? 'Location permission was not granted.' : 'Your location could not be read.')
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 })
  }

  return <div className="location-picker">
    <label className="field location-search-field">City or town
      <div className="location-search-row">
        <input value={query} onChange={(event) => editQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search() } }} placeholder="Search anywhere in the world" autoComplete="off" maxLength={160} aria-invalid={Boolean(visibleError)} aria-describedby="location-picker-error" />
        <button type="button" onClick={search} disabled={busy || query.trim().length < 2}>Search</button>
      </div>
    </label>
    <button className="location-current-button" type="button" onClick={useCurrentLocation} disabled={busy}>Use my current location</button>

    {results.length ? <div className="location-results" role="listbox" aria-label="Location results">
      {results.map((result) => <button type="button" role="option" onClick={() => select(result)} key={`${result.providerId || result.label}:${result.latitude}:${result.longitude}`}>
        <strong>{result.city}</strong><span>{[result.region, result.country].filter(Boolean).join(', ')}</span>
      </button>)}
    </div> : null}

    {location.latitude !== '' && location.longitude !== '' ? <div className="location-selected"><span>Selected location</span><strong>{location.label}</strong></div> : null}
    <p className="location-picker-message" aria-live="polite">{message}</p>
    <small className="field-error" id="location-picker-error" aria-live="polite">{visibleError}</small>

    <input type="hidden" name="city" value={location.city} />
    <input type="hidden" name="region" value={location.region} />
    <input type="hidden" name="country" value={location.country} />
    <input type="hidden" name="country_code" value={location.countryCode} />
    <input type="hidden" name="latitude" value={location.latitude} />
    <input type="hidden" name="longitude" value={location.longitude} />
    <input type="hidden" name="timezone" value={location.timezone} />
    <input type="hidden" name="location_label" value={location.label} />
    <input type="hidden" name="location_source" value={location.source} />
    <input type="hidden" name="location_accuracy_m" value={location.accuracy} />
  </div>
}
