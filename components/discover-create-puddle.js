"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPuddlePost } from '@/app/create/post/actions'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function placeLabel(point) {
  return point?.city || point?.neighborhood || String(point?.category || 'Saved place').replaceAll('_', ' ')
}

export function DiscoverCreatePuddle({ avatarUrl = null, displayName = 'Puddle person', points = [] }) {
  const safePoints = useMemo(() => Array.isArray(points) ? points.filter((point) => point?.id) : [], [points])
  const [open, setOpen] = useState(false)
  const [locationId, setLocationId] = useState(safePoints[0]?.id || '')
  const dockRef = useRef(null)
  const titleRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const frame = window.requestAnimationFrame(() => titleRef.current?.focus())
    const closeOutside = (event) => {
      if (!dockRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

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
      inert={!open ? '' : undefined}
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
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!safePoints.length} tabIndex={open ? 0 : -1}>
            {safePoints.length ? safePoints.map((point) => <option value={point.id} key={point.id}>{point.title} · {placeLabel(point)}</option>) : <option value="">Save a place first</option>}
          </select>
        </label>
        {!safePoints.length ? <small>Save a place before publishing a puddle.</small> : null}
      </div>
    </form>
  </div>
}
