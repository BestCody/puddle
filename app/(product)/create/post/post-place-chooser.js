"use client"

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

function categoryLabel(value) {
  return String(value || 'Park').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function PostPlaceChooser({ selectedPoint, initialPoints }) {
  const [points, setPoints] = useState(initialPoints || [])
  const [loaded, setLoaded] = useState(initialPoints !== null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(null)

  useEffect(() => () => requestRef.current?.abort(), [])

  async function loadPlaces() {
    if (loaded || requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/map/snapshot', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Place chooser returned ${response.status}`)
      const payload = await response.json()
      if (!Array.isArray(payload.points)) throw new Error('Place chooser returned invalid data')
      setPoints(payload.points)
      setLoaded(true)
    } catch {
      if (!controller.signal.aborted) setError('Your places could not be loaded. Try again.')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const selectablePoints = selectedPoint && !points.some((point) => point.id === selectedPoint.id)
    ? [selectedPoint, ...points]
    : points

  return <details className="figma-create-post-add" onToggle={(event) => { if (event.currentTarget.open) void loadPlaces() }}>
    <summary aria-label="Open add menu">＋</summary>
    <div className="figma-create-post-add-menu">
      <strong>Attach a place</strong>
      {selectablePoints.length ? <div className="figma-create-post-location-options">
        {selectablePoints.slice(0, 12).map((point) => <Link className={selectedPoint?.id === point.id ? 'is-selected' : ''} href={`/create/post?location=${encodeURIComponent(point.id)}`} key={point.id}><span>{point.title}</span><small>{point.city || categoryLabel(point.category)}</small></Link>)}
      </div> : loaded ? <p>Choose a place from Swipe, Saved, or the map.</p> : null}
      {loading ? <p role="status">Loading your places…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && !loading ? <button type="button" onClick={() => { void loadPlaces() }}>Try again</button> : null}
    </div>
    <div className="figma-create-post-add-footer"><span>{selectedPoint ? selectedPoint.title : 'No place selected'}</span></div>
  </details>
}
