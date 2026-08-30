"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPuddlePost } from '@/app/(product)/create/post/actions'
import { useModalFocus } from '@/components/modal-focus'
import { PhotoFrame } from '@/components/photo-frame'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function placeLabel(point) {
  return point?.city || point?.neighborhood || String(point?.category || 'Saved place').replaceAll('_', ' ')
}

export function DiscoverCreatePuddle({ avatarUrl = null, displayName = 'Puddle person', points = [], initialOpen = false, requestedLocation = '' }) {
  const initialPoints = useMemo(() => Array.isArray(points) ? points.filter((point) => point?.id) : [], [points])
  const [savedPoints, setSavedPoints] = useState(initialPoints)
  const [savedPointsLoaded, setSavedPointsLoaded] = useState(Boolean(initialPoints.length))
  const [savedPointsLoading, setSavedPointsLoading] = useState(false)
  const [savedPointsError, setSavedPointsError] = useState('')
  const [savedPointsRetry, setSavedPointsRetry] = useState(0)
  const [open, setOpen] = useState(Boolean(initialOpen))
  const [locationId, setLocationId] = useState(requestedLocation || initialPoints[0]?.id || '')
  const dockRef = useRef(null)
  const formRef = useRef(null)
  const titleRef = useRef(null)

  useModalFocus(formRef, titleRef, open)

  useEffect(() => {
    if (initialOpen) setOpen(true)
  }, [initialOpen])

  useEffect(() => {
    if (requestedLocation) setLocationId(requestedLocation)
  }, [requestedLocation])

  useEffect(() => {
    if (initialPoints.length) {
      setSavedPoints(initialPoints)
      setSavedPointsLoaded(true)
      setLocationId((current) => current || requestedLocation || initialPoints[0]?.id || '')
    }
  }, [initialPoints, requestedLocation])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!dockRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open || savedPointsLoaded) return undefined
    let active = true
    setSavedPointsLoading(true)
    setSavedPointsError('')

    async function loadSavedPoints() {
      try {
        const query = requestedLocation ? `?ids=${encodeURIComponent(requestedLocation)}` : ''
        const response = await fetch(`/api/saved-location-options${query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Saved locations returned ${response.status}`)
        const payload = await response.json()
        if (!active) return
        const items = Array.isArray(payload?.items) ? payload.items.filter((point) => point?.id) : []
        setSavedPoints(items)
        setLocationId((current) => current || requestedLocation || items[0]?.id || '')
      } catch {
        if (active) {
          setSavedPoints([])
          setSavedPointsError('Saved places could not be loaded.')
        }
      } finally {
        if (active) {
          setSavedPointsLoaded(true)
          setSavedPointsLoading(false)
        }
      }
    }

    loadSavedPoints()
    return () => { active = false }
  }, [open, requestedLocation, savedPointsLoaded, savedPointsRetry])

  function retrySavedPoints() {
    setSavedPointsLoaded(false)
    setSavedPointsRetry((value) => value + 1)
  }

  return <div className={`puddle-discover-create-dock${open ? ' is-open' : ''}`} data-testid="feed-composer" ref={dockRef}>
    <button className="puddle-discover-create-trigger" type="button" aria-expanded={open} aria-controls="discover-create-puddle-form" onClick={() => setOpen(true)}>
      <PhotoFrame as="span" className="puddle-discover-create-avatar" src={avatarUrl} alt="" unavailableText={initials(displayName)} loadingText="" />
      <span className="puddle-discover-create-placeholder">Create a puddle...</span>
      <span className="puddle-discover-create-arrow" aria-hidden="true">↑</span>
    </button>

    <form ref={formRef} action={createPuddlePost} className="puddle-discover-create-form" id="discover-create-puddle-form" role="dialog" aria-modal="true" aria-label="Create a puddle" aria-hidden={!open} inert={!open} tabIndex={-1}>
      <input type="hidden" name="location_id" value={locationId} />
      <header className="puddle-discover-create-header">
        <PhotoFrame as="span" className="puddle-discover-create-avatar" src={avatarUrl} alt="" unavailableText={initials(displayName)} loadingText="" />
        <fieldset className="puddle-discover-create-visibility" aria-label="Post visibility">
          <label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label>
          <label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label>
        </fieldset>
        <button className="puddle-discover-create-close" type="button" onClick={() => setOpen(false)} aria-label="Close create puddle">×</button>
        <button className="puddle-discover-create-submit" type="submit" disabled={!locationId} aria-label="Publish puddle">↑</button>
      </header>
      <label className="puddle-discover-create-title"><span className="sr-only">Title</span><input ref={titleRef} name="title" maxLength="80" required placeholder="Title" tabIndex={open ? 0 : -1} /></label>
      <label className="puddle-discover-create-description"><span className="sr-only">Description</span><textarea name="description" maxLength="1000" placeholder="Description" tabIndex={open ? 0 : -1} /></label>
      <div className="puddle-discover-create-footer">
        <label className="puddle-discover-create-place">
          <span>Saved place</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!savedPoints.length} tabIndex={open ? 0 : -1}>
            {savedPoints.length ? savedPoints.map((point) => <option value={point.id} key={point.id}>{point.title} · {placeLabel(point)}</option>) : <option value="">Save a place first</option>}
          </select>
        </label>
        {savedPointsLoading ? <small>Loading saved places...</small> : savedPointsError ? <small role="alert">{savedPointsError} <button type="button" onClick={retrySavedPoints}>Try again</button></small> : !savedPoints.length ? <small>Save a place before publishing a puddle.</small> : null}
      </div>
    </form>
  </div>
}
