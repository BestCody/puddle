"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPuddlePost } from '@/app/(product)/create/post/actions'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function placeLabel(point) {
  return point?.city || point?.neighborhood || String(point?.category || 'Saved place').replaceAll('_', ' ')
}

export function DiscoverCreatePuddle({ avatarUrl = null, displayName = 'Puddle person', points = [] }) {
  const initialPoints = useMemo(() => Array.isArray(points) ? points.filter((point) => point?.id) : [], [points])
  const [savedPoints, setSavedPoints] = useState(initialPoints)
  const [savedPointsLoaded, setSavedPointsLoaded] = useState(Boolean(initialPoints.length))
  const [savedPointsLoading, setSavedPointsLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [locationId, setLocationId] = useState(initialPoints[0]?.id || '')
  const dockRef = useRef(null)
  const titleRef = useRef(null)

  useEffect(() => {
    if (initialPoints.length) {
      setSavedPoints(initialPoints)
      setSavedPointsLoaded(true)
      setLocationId((current) => current || initialPoints[0]?.id || '')
    }
  }, [initialPoints])

  useEffect(() => {
    if (!open) return undefined

    let active = true
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus())
    const closeOutside = (event) => {
      if (!dockRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    async function loadSavedPoints() {
      if (savedPointsLoaded || savedPointsLoading) return
      setSavedPointsLoading(true)
      try {
        const response = await fetch('/api/saved-location-options', { cache: 'no-store' })
        const payload = response.ok ? await response.json() : null
        if (!active) return
        const items = Array.isArray(payload?.items) ? payload.items.filter((point) => point?.id) : []
        setSavedPoints(items)
        setLocationId((current) => current || items[0]?.id || '')
      } catch {
        if (active) setSavedPoints([])
      } finally {
        if (active) {
          setSavedPointsLoaded(true)
          setSavedPointsLoading(false)
        }
      }
    }

    loadSavedPoints()
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      active = false
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, savedPointsLoaded])

  return <div
    className={`puddle-discover-create-dock${open ? ' is-open' : ''}`}
    data-testid="feed-composer"
    ref={dockRef}
  >
    <button
      className="puddle-discover-create-trigger"
      type="button"
      aria-expanded={open}
      aria-controls="discover-create-puddle-form"
      onClick={() => setOpen(true)}
    >
      <span className="puddle-discover-create-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>
        {avatarUrl ? null : initials(displayName)}
      </span>
      <span className="puddle-discover-create-placeholder">Create a puddle...</span>
      <b className="puddle-discover-create-arrow" aria-hidden="true">↑</b>
    </button>

    <form
      action={createPuddlePost}
      className="puddle-discover-create-form"
      id="discover-create-puddle-form"
      aria-label="Create a puddle"
      aria-hidden={!open}
      inert={!open}
    >
      <input type="hidden" name="location_id" value={locationId} />

      <header className="puddle-discover-create-header">
        <span className="puddle-discover-create-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>
          {avatarUrl ? null : initials(displayName)}
        </span>
        <fieldset className="puddle-discover-create-visibility" aria-label="Post visibility">
          <label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label>
          <label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label>
        </fieldset>
        <button className="puddle-discover-create-close" type="button" onClick={() => setOpen(false)} aria-label="Close create puddle">×</button>
        <button className="puddle-discover-create-submit" type="submit" disabled={!locationId} aria-label="Publish puddle">↑</button>
      </header>

      <label className="puddle-discover-create-title">
        <span className="sr-only">Title</span>
        <input ref={titleRef} name="title" maxLength="80" required placeholder="Title" tabIndex={open ? 0 : -1} />
      </label>
      <label className="puddle-discover-create-description">
        <span className="sr-only">Description</span>
        <textarea name="description" maxLength="1000" placeholder="Description" tabIndex={open ? 0 : -1} />
      </label>

      <div className="puddle-discover-create-footer">
        <label className="puddle-discover-create-place">
          <span>Saved place</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!savedPoints.length} tabIndex={open ? 0 : -1}>
            {savedPoints.length ? savedPoints.map((point) => <option value={point.id} key={point.id}>{point.title} · {placeLabel(point)}</option>) : <option value="">Save a place first</option>}
          </select>
        </label>
        {!savedPoints.length ? <small>Save a place before publishing a puddle.</small> : null}
      </div>
    </form>
  </div>
}
