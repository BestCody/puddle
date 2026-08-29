"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'
import { useModalFocus } from '@/components/modal-focus'

const PREFERENCE_CATEGORIES = [
  { value: 'cafe', label: 'Coffee shops' },
  { value: 'restaurant', label: 'Restaurants' },
  { value: 'bar', label: 'Bars & lounges' },
  { value: 'park', label: 'Parks & gardens' },
  { value: 'museum', label: 'Museums' },
  { value: 'gallery', label: 'Galleries' },
  { value: 'attraction', label: 'Local attractions' },
  { value: 'activity_venue', label: 'Activity dates' },
  { value: 'scenic_spot', label: 'Scenic spots' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'shop', label: 'Markets & bookstores' },
  { value: 'community_space', label: 'Community spaces' }
]

const DISTANCE_OPTIONS = [2, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000, 20_040]

function categoryLabel(value) {
  return PREFERENCE_CATEGORIES.find((option) => option.value === value)?.label || String(value).replaceAll('_', ' ')
}

export function DiscoveryFilterSheet({ filters, categories = [], onChange, onApply, onClose, loading }) {
  const sheetRef = useRef(null)
  const closeRef = useRef(null)
  const [locationQuery, setLocationQuery] = useState(filters.locationLabel || '')
  const [locationResults, setLocationResults] = useState([])
  const [locationMessage, setLocationMessage] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)

  useModalFocus(sheetRef, closeRef)

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    setLocationQuery(filters.locationLabel || '')
  }, [filters.locationLabel])

  const categoryOptions = useMemo(() => {
    const values = [...new Set([...PREFERENCE_CATEGORIES.map((option) => option.value), ...categories.filter(Boolean)])]
    return values.map((value) => ({ value, label: categoryLabel(value) }))
  }, [categories])

  function selectLocation(result, sourceMessage = 'Location selected.') {
    onChange('latitude', Number(result.latitude))
    onChange('longitude', Number(result.longitude))
    onChange('locationLabel', result.label || [result.city, result.region, result.country].filter(Boolean).join(', '))
    setLocationQuery(result.label || [result.city, result.region, result.country].filter(Boolean).join(', '))
    setLocationResults([])
    setLocationMessage(sourceMessage)
  }

  async function searchLocation() {
    const value = locationQuery.trim()
    if (value.length < 2 || locationBusy) return
    setLocationBusy(true)
    setLocationMessage('')
    try {
      const response = await fetch(`/api/location/search?q=${encodeURIComponent(value)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'City search is unavailable.')
      setLocationResults(payload.results || [])
      if (!(payload.results || []).length) setLocationMessage('No matching cities found.')
    } catch (error) {
      setLocationMessage(error.message || 'City search is unavailable.')
    } finally {
      setLocationBusy(false)
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation || locationBusy) {
      setLocationMessage('Location access is not supported in this browser.')
      return
    }
    setLocationBusy(true)
    setLocationMessage('Requesting your location…')
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await csrfFetch('/api/location/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'We could not identify your location.')
        selectLocation(payload.result, 'Current location selected.')
      } catch (error) {
        setLocationMessage(error.message || 'We could not identify your location.')
      } finally {
        setLocationBusy(false)
      }
    }, (error) => {
      setLocationBusy(false)
      setLocationMessage(error.code === 1 ? 'Location permission was not granted.' : 'Your location could not be read.')
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 })
  }

  return (
    <div className="minimal-details-backdrop puddle-universal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={sheetRef} className="minimal-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-title" tabIndex={-1}>
        <header><h2 id="filter-title">Filters</h2><button ref={closeRef} type="button" onClick={onClose} aria-label="Close filters">×</button></header>

        <div className="location-picker">
          <label className="field location-search-field">Location
            <div className="location-search-row">
              <input
                value={locationQuery}
                onChange={(event) => { setLocationQuery(event.target.value.slice(0, 160)); setLocationResults([]); setLocationMessage('') }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchLocation() } }}
                placeholder="Search city or town"
                autoComplete="off"
                maxLength={160}
              />
              <button type="button" onClick={searchLocation} disabled={locationBusy || locationQuery.trim().length < 2}>Search</button>
            </div>
          </label>
          <button className="location-current-button" type="button" onClick={useCurrentLocation} disabled={locationBusy}>Use my current location</button>
          {locationResults.length ? <div className="location-results" role="listbox" aria-label="Location results">
            {locationResults.map((result) => <button type="button" role="option" onClick={() => selectLocation(result)} key={`${result.providerId || result.label}:${result.latitude}:${result.longitude}`}>
              <strong>{result.city}</strong><span>{[result.region, result.country].filter(Boolean).join(', ')}</span>
            </button>)}
          </div> : null}
          <p className="location-picker-message" aria-live="polite">{locationMessage}</p>
        </div>

        <label>Category<select value={filters.category || ''} onChange={(event) => onChange('category', event.target.value)}>
          <option value="">Any category</option>
          {categoryOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>
        <label>Distance<select value={String(filters.distance || 10)} onChange={(event) => onChange('distance', Number(event.target.value))}>{DISTANCE_OPTIONS.map((value) => <option value={value} key={value}>{value === 20_040 ? 'Anywhere' : `${value.toLocaleString()} km`}</option>)}</select></label>
        <label>Price<select value={filters.price || 'any'} onChange={(event) => onChange('price', event.target.value)}><option value="any">Any price</option><option value="1">$</option><option value="2">$$</option><option value="3">$$$</option><option value="4">$$$$</option></select></label>
        <label className="minimal-filter-check"><input type="checkbox" checked={Boolean(filters.openNow)} onChange={(event) => onChange('openNow', event.target.checked)} /> Open now</label>
        <label className="minimal-filter-check"><input type="checkbox" checked={Boolean(filters.accessible)} onChange={(event) => onChange('accessible', event.target.checked)} /> Accessible</label>
        <button className="minimal-primary-button" type="button" onClick={onApply} disabled={loading || locationBusy}>{loading ? 'Loading…' : 'Apply'}</button>
      </section>
    </div>
  )
}
