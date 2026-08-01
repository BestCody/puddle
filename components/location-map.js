"use client"

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

const TILE_SIZE = 256
const MIN_ZOOM = 3
const MAX_ZOOM = 18

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function worldSize(zoom) { return TILE_SIZE * (2 ** zoom) }
function project(latitude, longitude, zoom) {
  const size = worldSize(zoom)
  const lat = clamp(Number(latitude), -85.0511, 85.0511) * Math.PI / 180
  return {
    x: (Number(longitude) + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size
  }
}
function unproject(x, y, zoom) {
  const size = worldSize(zoom)
  const longitude = x / size * 360 - 180
  const n = Math.PI - 2 * Math.PI * y / size
  const latitude = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { latitude, longitude }
}
function stateLabel(state) { return state === 'matched' ? 'Match' : state === 'planned' ? 'Planned' : 'Saved' }
function directionsUrl(point) { return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.latitude},${point.longitude}`)}` }

function MapTileLayer({ center, zoom, viewport }) {
  const projectedCenter = project(center.latitude, center.longitude, zoom)
  const tileCount = 2 ** zoom
  const minX = Math.floor((projectedCenter.x - viewport.width / 2) / TILE_SIZE) - 1
  const maxX = Math.floor((projectedCenter.x + viewport.width / 2) / TILE_SIZE) + 1
  const minY = Math.max(0, Math.floor((projectedCenter.y - viewport.height / 2) / TILE_SIZE) - 1)
  const maxY = Math.min(tileCount - 1, Math.floor((projectedCenter.y + viewport.height / 2) / TILE_SIZE) + 1)
  const tiles = []
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount
      tiles.push({
        key: `${zoom}:${x}:${y}`,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
        left: x * TILE_SIZE - projectedCenter.x + viewport.width / 2,
        top: y * TILE_SIZE - projectedCenter.y + viewport.height / 2
      })
    }
  }
  return <div className="location-map-tiles" aria-hidden="true">{tiles.map((tile) => <img key={tile.key} src={tile.src} alt="" draggable="false" width="256" height="256" style={{ transform: `translate3d(${tile.left}px,${tile.top}px,0)` }} />)}</div>
}

function PointCard({ point }) {
  if (!point) return <div className="location-map-empty-selection"><span aria-hidden="true">⌖</span><strong>Select a marker</strong><p>Compare saved places, shared matches, and upcoming plans without reopening the full discovery map.</p></div>
  return <article className="location-map-card">
    <div className="location-map-card-photo" style={point.photo_url ? { backgroundImage: `linear-gradient(180deg,transparent,rgba(23,17,20,.68)),url(${point.photo_url})` } : undefined}><span>{point.states.map(stateLabel).join(' · ')}</span></div>
    <div><small>{point.neighborhood || point.city || String(point.category || 'location').replaceAll('_', ' ')}</small><h2>{point.title}</h2><p>{point.summary}</p><div className="location-map-card-tags">{point.states.map((state) => <span className={`is-${state}`} key={state}>{stateLabel(state)}</span>)}</div>{point.plan?.planned_for ? <strong className="location-map-plan-time">{new Date(point.plan.planned_for).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong> : null}<div className="location-map-card-actions"><Link href={point.href}>Open details</Link><a href={directionsUrl(point)} target="_blank" rel="noreferrer">Directions ↗</a></div></div>
  </article>
}

export function LocationMap({ initialPoints, initialCenter }) {
  const mapRef = useRef(null)
  const dragRef = useRef(null)
  const [viewport, setViewport] = useState({ width: 900, height: 620 })
  const [center, setCenter] = useState(initialCenter || { latitude: 43.6532, longitude: -79.3832 })
  const [zoom, setZoom] = useState(initialPoints.length <= 1 ? 14 : 12)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(initialPoints[0]?.id || null)

  useEffect(() => {
    const node = mapRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: Math.max(280, entry.contentRect.width), height: Math.max(420, entry.contentRect.height) }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const points = useMemo(() => filter === 'all' ? initialPoints : initialPoints.filter((point) => point.states.includes(filter)), [initialPoints, filter])
  const selected = initialPoints.find((point) => point.id === selectedId) || points[0] || null
  const projectedCenter = project(center.latitude, center.longitude, zoom)

  function changeFilter(next) {
    setFilter(next)
    const first = next === 'all' ? initialPoints[0] : initialPoints.find((point) => point.states.includes(next))
    if (first) { setSelectedId(first.id); setCenter({ latitude: first.latitude, longitude: first.longitude }) }
  }
  function selectPoint(point) { setSelectedId(point.id); setCenter({ latitude: point.latitude, longitude: point.longitude }) }
  function pointerDown(event) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, center: projectedCenter }
  }
  function pointerMove(event) {
    const drag = dragRef.current
    if (!drag) return
    const next = unproject(drag.center.x - (event.clientX - drag.x), drag.center.y - (event.clientY - drag.y), zoom)
    setCenter(next)
  }
  function pointerUp(event) { dragRef.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {} }
  function wheel(event) {
    event.preventDefault()
    setZoom((value) => clamp(value + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM))
  }
  function locate() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((position) => { setCenter({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setZoom(14) }, () => {}, { maximumAge: 300000, timeout: 8000 })
  }

  return <div className="location-map-workspace">
    <section className="location-map-toolbar">
      <div className="location-map-filters" aria-label="Map filters">{['all', 'saved', 'matched', 'planned'].map((state) => <button type="button" className={filter === state ? 'is-active' : ''} onClick={() => changeFilter(state)} key={state}>{state === 'all' ? 'All places' : stateLabel(state)}<strong>{state === 'all' ? initialPoints.length : initialPoints.filter((point) => point.states.includes(state)).length}</strong></button>)}</div>
      <button className="location-map-locate" type="button" onClick={locate}>◎ Near me</button>
    </section>
    <div className="location-map-layout">
      <section className="location-map-canvas" ref={mapRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel} aria-label="Interactive map of saved, matched, and planned locations">
        <MapTileLayer center={center} zoom={zoom} viewport={viewport} />
        <div className="location-map-markers">{points.map((point) => {
          const projected = project(point.latitude, point.longitude, zoom)
          const x = projected.x - projectedCenter.x + viewport.width / 2
          const y = projected.y - projectedCenter.y + viewport.height / 2
          const primary = point.states.includes('planned') ? 'planned' : point.states.includes('matched') ? 'matched' : 'saved'
          return <button type="button" className={`location-map-marker is-${primary} ${selectedId === point.id ? 'is-selected' : ''}`} style={{ transform: `translate3d(${x}px,${y}px,0)` }} onClick={(event) => { event.stopPropagation(); selectPoint(point) }} aria-label={`${point.title}, ${point.states.map(stateLabel).join(', ')}`} key={point.id}><span>{primary === 'planned' ? '⌖' : primary === 'matched' ? '♡' : '♥'}</span></button>
        })}</div>
        <div className="location-map-zoom"><button type="button" onClick={(event) => { event.stopPropagation(); setZoom((value) => clamp(value + 1, MIN_ZOOM, MAX_ZOOM)) }} aria-label="Zoom in">+</button><button type="button" onClick={(event) => { event.stopPropagation(); setZoom((value) => clamp(value - 1, MIN_ZOOM, MAX_ZOOM)) }} aria-label="Zoom out">−</button></div>
        <a className="location-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
      </section>
      <aside className="location-map-side"><PointCard point={selected} /><div className="location-map-list">{points.map((point) => <button type="button" className={selectedId === point.id ? 'is-active' : ''} onClick={() => selectPoint(point)} key={point.id}><span className={`is-${point.states.includes('planned') ? 'planned' : point.states.includes('matched') ? 'matched' : 'saved'}`} aria-hidden="true" /><div><strong>{point.title}</strong><small>{point.neighborhood || point.city || categoryLabel(point.category)}</small></div></button>)}</div></aside>
    </div>
  </div>
}

function categoryLabel(value) { return String(value || 'Location').replaceAll('_', ' ') }
