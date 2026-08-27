"use client"

import Link from 'next/link'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const TILE_SIZE = 256
const MIN_ZOOM = 3
const MAX_ZOOM = 18
const MARKER_OVERSCAN = 72
const CATALOGUE_CACHE_LIMIT = 24

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function normalizeLongitude(value) { return ((((Number(value) + 180) % 360) + 360) % 360) - 180 }
function worldSize(zoom) { return TILE_SIZE * (2 ** zoom) }
function project(latitude, longitude, zoom) {
  const size = worldSize(zoom)
  const lat = clamp(Number(latitude), -85.0511, 85.0511) * Math.PI / 180
  return {
    x: (normalizeLongitude(longitude) + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size
  }
}
function unproject(x, y, zoom) {
  const size = worldSize(zoom)
  const longitude = normalizeLongitude(x / size * 360 - 180)
  const n = Math.PI - 2 * Math.PI * y / size
  const latitude = clamp(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -85.0511, 85.0511)
  return { latitude, longitude }
}
function projectedXOffset(x, centerX, zoom) {
  const size = worldSize(zoom)
  let offset = x - centerX
  if (offset > size / 2) offset -= size
  if (offset < -size / 2) offset += size
  return offset
}
function viewportBounds(center, zoom, viewport) {
  const projectedCenter = project(center.latitude, center.longitude, zoom)
  const horizontalPadding = viewport.width * .18
  const verticalPadding = viewport.height * .18
  const topLeft = unproject(projectedCenter.x - viewport.width / 2 - horizontalPadding, projectedCenter.y - viewport.height / 2 - verticalPadding, zoom)
  const bottomRight = unproject(projectedCenter.x + viewport.width / 2 + horizontalPadding, projectedCenter.y + viewport.height / 2 + verticalPadding, zoom)
  return {
    north: Math.max(topLeft.latitude, bottomRight.latitude),
    south: Math.min(topLeft.latitude, bottomRight.latitude),
    west: topLeft.longitude,
    east: bottomRight.longitude
  }
}
function viewportCacheKey(bounds, zoom) {
  const precision = zoom < 8 ? 2 : zoom < 12 ? 3 : 4
  return [zoom, bounds.north, bounds.south, bounds.west, bounds.east].map((value, index) => index ? Number(value).toFixed(precision) : value).join(':')
}
function stateLabel(state) {
  if (state === 'matched') return 'Match'
  if (state === 'planned') return 'Planned'
  if (state === 'catalogue') return 'Puddle'
  return 'Saved'
}
function primaryState(point) {
  if (point.states.includes('planned')) return 'planned'
  if (point.states.includes('matched')) return 'matched'
  if (point.states.includes('saved')) return 'saved'
  return 'catalogue'
}
function directionsUrl(point) { return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.latitude},${point.longitude}`)}` }
function clusterCellSize(zoom) {
  if (zoom < 7) return 128
  if (zoom < 9) return 104
  if (zoom < 11) return 82
  if (zoom < 13) return 62
  return 0
}

const MapTileLayer = memo(function MapTileLayer({ center, zoom, viewport }) {
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
})

function MapCardPhoto({ point }) {
  const [failed, setFailed] = useState(false)
  const unavailable = !point.photo_url || failed
  return <div className={`location-map-card-photo${unavailable ? ' is-unavailable' : ''}`}>
    {!unavailable ? <img src={point.photo_url} alt={`${point.title} photo`} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="location-map-card-photo-empty">Photo unavailable</span>}
    <span className="location-map-card-photo-state">{point.states.map(stateLabel).join(' · ')}</span>
  </div>
}

function PointCard({ point }) {
  if (!point) return <div className="location-map-empty-selection"><span aria-hidden="true">⌖</span><strong>Select a marker</strong><p>Compare saved places, shared matches, upcoming plans, and Puddle locations in this map area.</p></div>
  return <article className="location-map-card">
    <MapCardPhoto key={point.id} point={point} />
    <div><small>{point.neighborhood || point.city || String(point.category || 'location').replaceAll('_', ' ')}</small><h2>{point.title}</h2><p>{point.summary}</p><div className="location-map-card-tags">{point.states.map((state) => <span className={`is-${state}`} key={state}>{stateLabel(state)}</span>)}</div>{point.plan?.planned_for ? <strong className="location-map-plan-time">{new Date(point.plan.planned_for).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong> : null}<div className="location-map-card-actions"><a href={directionsUrl(point)} target="_blank" rel="noreferrer">Directions</a></div></div>
  </article>
}

export function LocationMap({ initialPoints = [], initialCenter, heatmapPoints = [], passActive = false, loadCatalogue = false, selectingForPost = false }) {
  const mapRef = useRef(null)
  const panLayerRef = useRef(null)
  const dragRef = useRef(null)
  const pressRef = useRef(null)
  const suppressClickUntilRef = useRef(0)
  const panFrameRef = useRef(0)
  const pendingPanRef = useRef(null)
  const wheelFrameRef = useRef(0)
  const pendingWheelDeltaRef = useRef(0)
  const catalogueCacheRef = useRef(new Map())
  const catalogueRequestRef = useRef(0)
  const heatmapRequestRef = useRef(0)
  const [viewport, setViewport] = useState({ width: 900, height: 620 })
  const [center, setCenter] = useState(initialCenter || { latitude: 43.6532, longitude: -79.3832 })
  const [zoom, setZoom] = useState(initialPoints.length <= 1 ? 14 : 12)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(initialPoints[0]?.id || null)
  const [selectedPoint, setSelectedPoint] = useState(initialPoints[0] || null)
  const [heatmapEnabled, setHeatmapEnabled] = useState(Boolean(passActive))
  const [visibleHeatmap, setVisibleHeatmap] = useState(heatmapPoints)
  const [cataloguePoints, setCataloguePoints] = useState([])
  const [catalogueState, setCatalogueState] = useState('idle')
  const [catalogueRetry, setCatalogueRetry] = useState(0)
  const [locationState, setLocationState] = useState('idle')

  const wheel = useCallback((event) => {
    // Ctrl+wheel is browser zoom. Keep it from changing the page while the
    // pointer is over the map; regular wheel input is the map zoom gesture.
    if (event.ctrlKey || !event.deltaY) return
    pendingWheelDeltaRef.current += event.deltaY
    if (wheelFrameRef.current) return
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      wheelFrameRef.current = 0
      const delta = pendingWheelDeltaRef.current
      pendingWheelDeltaRef.current = 0
      if (delta) setZoom((value) => clamp(value + (delta < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM))
    })
  }, [])

  useEffect(() => {
    const node = mapRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: Math.max(280, entry.contentRect.width), height: Math.max(420, entry.contentRect.height) }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = mapRef.current
    if (!node) return undefined
    // React's delegated wheel listener can be treated as passive by the
    // browser. Bind at the canvas with passive:false so page scrolling and
    // browser zoom are reliably cancelled only inside the map surface.
    const onWheel = (event) => {
      event.preventDefault()
      event.stopPropagation()
      wheel(event)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [wheel])

  useEffect(() => () => {
    if (panFrameRef.current) window.cancelAnimationFrame(panFrameRef.current)
    if (wheelFrameRef.current) window.cancelAnimationFrame(wheelFrameRef.current)
  }, [])

  // Panning is rendered by the compositor while the pointer is down. The
  // React state update happens only after release, so projection, list layout,
  // and viewport fetching cannot compete with the drag frame.
  useLayoutEffect(() => {
    if (!dragRef.current && panLayerRef.current) panLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
  }, [center.latitude, center.longitude, zoom])

  useEffect(() => {
    const requestId = ++catalogueRequestRef.current
    if (!loadCatalogue || filter !== 'all') {
      setCatalogueState('idle')
      return undefined
    }
    const controller = new AbortController()
    setCatalogueState('loading')
    const timer = window.setTimeout(async () => {
      const bounds = viewportBounds(center, zoom, viewport)
      const cacheKey = viewportCacheKey(bounds, zoom)
      const cached = catalogueCacheRef.current.get(cacheKey)
      if (cached) {
        if (!controller.signal.aborted && requestId === catalogueRequestRef.current) {
          setCataloguePoints(cached)
          setCatalogueState('ready')
        }
        return
      }
      const params = new URLSearchParams({
        north: bounds.north.toFixed(6), south: bounds.south.toFixed(6),
        west: bounds.west.toFixed(6), east: bounds.east.toFixed(6), zoom: String(zoom)
      })
      try {
        const response = await fetch(`/api/map/viewport?${params}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`Map viewport returned ${response.status}`)
        const payload = await response.json()
        const next = (Array.isArray(payload?.points) ? payload.points : []).map((point) => selectingForPost ? { ...point, href: `/create/post?location=${encodeURIComponent(point.id)}` } : point)
        const cache = catalogueCacheRef.current
        cache.set(cacheKey, next)
        if (cache.size > CATALOGUE_CACHE_LIMIT) cache.delete(cache.keys().next().value)
        if (!controller.signal.aborted && requestId === catalogueRequestRef.current) {
          setCataloguePoints(next)
          setCatalogueState('ready')
        }
      } catch (error) {
        if (error?.name !== 'AbortError' && requestId === catalogueRequestRef.current) {
          setCatalogueState('error')
          console.warn('Could not refresh visible Puddle locations.', { message: error?.message || 'unknown error' })
        }
      }
    }, 280)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [catalogueRetry, center.latitude, center.longitude, filter, loadCatalogue, selectingForPost, viewport.height, viewport.width, zoom])

  useEffect(() => {
    const requestId = ++heatmapRequestRef.current
    if (!passActive || !heatmapEnabled) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const bounds = viewportBounds(center, zoom, viewport)
      const params = new URLSearchParams({
        north: bounds.north.toFixed(6), south: bounds.south.toFixed(6),
        west: bounds.west.toFixed(6), east: bounds.east.toFixed(6), zoom: String(zoom)
      })
      try {
        const response = await fetch(`/api/map/heatmap?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Map heatmap returned ${response.status}`)
        const payload = await response.json()
        if (!controller.signal.aborted && requestId === heatmapRequestRef.current) setVisibleHeatmap(Array.isArray(payload?.cells) ? payload.cells : [])
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('Could not refresh visible Pass heatmap.', { message: error?.message || 'unknown error' })
      }
    }, 320)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [center.latitude, center.longitude, heatmapEnabled, passActive, viewport.height, viewport.width, zoom])

  const allPoints = useMemo(() => {
    const merged = new Map()
    for (const point of cataloguePoints) merged.set(point.id, point)
    for (const point of initialPoints) {
      const existing = merged.get(point.id)
      merged.set(point.id, existing ? {
        ...existing, ...point,
        photo_url: point.photo_url || existing.photo_url,
        states: [...new Set([...(existing.states || []), ...(point.states || [])])]
      } : point)
    }
    if (selectedPoint?.id === selectedId && !merged.has(selectedPoint.id)) merged.set(selectedPoint.id, selectedPoint)
    return [...merged.values()]
  }, [cataloguePoints, initialPoints, selectedId, selectedPoint])

  const points = useMemo(() => filter === 'all' ? allPoints : allPoints.filter((point) => point.states.includes(filter)), [allPoints, filter])
  // Keep the point captured by the marker click authoritative while the
  // viewport request replaces the catalogue window. The request may briefly
  // contain a different slice (or an older version of the same row), but the
  // details card must never disappear during that refresh.
  const selected = selectedPoint?.id === selectedId
    ? selectedPoint
    : allPoints.find((point) => point.id === selectedId) || points[0] || null
  const projectedCenter = project(center.latitude, center.longitude, zoom)
  const maxHeat = Math.max(1, ...visibleHeatmap.map((point) => Number(point.save_count) || 0))

  const visiblePointItems = useMemo(() => points.map((point) => {
    const projected = project(point.latitude, point.longitude, zoom)
    return {
      point,
      x: projectedXOffset(projected.x, projectedCenter.x, zoom) + viewport.width / 2,
      y: projected.y - projectedCenter.y + viewport.height / 2
    }
  }).filter((item) => item.x >= -MARKER_OVERSCAN && item.x <= viewport.width + MARKER_OVERSCAN && item.y >= -MARKER_OVERSCAN && item.y <= viewport.height + MARKER_OVERSCAN), [points, projectedCenter.x, projectedCenter.y, viewport.height, viewport.width, zoom])

  const markerGroups = useMemo(() => {
    const cellSize = clusterCellSize(zoom)
    if (!cellSize) return visiblePointItems.map((item) => ({ type: 'point', ...item }))
    const cells = new Map()
    for (const item of visiblePointItems) {
      const key = `${Math.floor(item.x / cellSize)}:${Math.floor(item.y / cellSize)}`
      const cell = cells.get(key) || []
      cell.push(item)
      cells.set(key, cell)
    }
    return [...cells.entries()].map(([key, items]) => {
      if (items.length === 1 && zoom >= 11) return { type: 'point', ...items[0] }
      return {
        type: 'cluster',
        key,
        count: items.length,
        x: items.reduce((sum, item) => sum + item.x, 0) / items.length,
        y: items.reduce((sum, item) => sum + item.y, 0) / items.length,
        latitude: items.reduce((sum, item) => sum + Number(item.point.latitude), 0) / items.length,
        longitude: items.reduce((sum, item) => sum + Number(item.point.longitude), 0) / items.length
      }
    })
  }, [visiblePointItems, zoom])

  function changeFilter(next) {
    setFilter(next)
    const first = next === 'all' ? allPoints[0] : allPoints.find((point) => point.states.includes(next))
    if (first) {
      setSelectedPoint(first)
      setSelectedId(first.id)
      setCenter({ latitude: first.latitude, longitude: first.longitude })
    } else {
      setSelectedPoint(null)
      setSelectedId(null)
    }
  }
  function selectPoint(point) {
    setSelectedPoint(point)
    setSelectedId(point.id)
    setCenter({ latitude: point.latitude, longitude: point.longitude })
  }
  function openCluster(cluster) {
    setCenter({ latitude: cluster.latitude, longitude: cluster.longitude })
    setZoom((value) => clamp(value + (value < 9 ? 2 : 1), MIN_ZOOM, MAX_ZOOM))
  }
  function startDrag(event, press) {
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.style.cursor = 'grabbing'
    event.currentTarget.classList.add('is-dragging')
    if (panLayerRef.current) panLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
    dragRef.current = press
    pendingPanRef.current = null
  }
  function pointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return
    const press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, center: projectedCenter, zoom }
    // Let a marker or cluster receive a normal click. If the pointer moves
    // far enough, pointerMove promotes that press into a map drag instead.
    if (event.target?.closest?.('button,a')) {
      pressRef.current = press
      return
    }
    startDrag(event, press)
  }
  function pointerMove(event) {
    if (!dragRef.current && pressRef.current?.pointerId === event.pointerId) {
      const press = pressRef.current
      const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y)
      if (distance > 6) {
        pressRef.current = null
        suppressClickUntilRef.current = Date.now() + 350
        startDrag(event, press)
      }
    }
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const x = event.clientX - drag.x
    const y = event.clientY - drag.y
    pendingPanRef.current = {
      x,
      y,
      center: unproject(drag.center.x - x, drag.center.y - y, drag.zoom)
    }
    if (panFrameRef.current) return
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = 0
      const pending = pendingPanRef.current
      if (!pending || !dragRef.current) return
      if (panLayerRef.current) panLayerRef.current.style.transform = `translate3d(${pending.x}px, ${pending.y}px, 0)`
    })
  }
  function pointerUp(event) {
    if (!dragRef.current && pressRef.current?.pointerId === event.pointerId) {
      pressRef.current = null
      return
    }
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    pressRef.current = null
    const x = event.clientX - drag.x
    const y = event.clientY - drag.y
    pendingPanRef.current = null
    if (panFrameRef.current) {
      window.cancelAnimationFrame(panFrameRef.current)
      panFrameRef.current = 0
    }
    if (x || y) setCenter(unproject(drag.center.x - x, drag.center.y - y, drag.zoom))
    event.currentTarget.style.cursor = 'grab'
    event.currentTarget.classList.remove('is-dragging')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
  }
  function pointerCancel(event) {
    if (!dragRef.current && pressRef.current?.pointerId === event.pointerId) {
      pressRef.current = null
      return
    }
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const pending = pendingPanRef.current
    dragRef.current = null
    pendingPanRef.current = null
    pressRef.current = null
    if (panFrameRef.current) {
      window.cancelAnimationFrame(panFrameRef.current)
      panFrameRef.current = 0
    }
    if (panLayerRef.current) panLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
    if (pending) setCenter(pending.center)
    event.currentTarget.style.cursor = 'grab'
    event.currentTarget.classList.remove('is-dragging')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
  }
  function consumeDragClick(event) {
    if (suppressClickUntilRef.current <= Date.now()) return false
    suppressClickUntilRef.current = 0
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  function locate() {
    if (!navigator.geolocation) {
      setLocationState('unavailable')
      return
    }
    setLocationState('loading')
    navigator.geolocation.getCurrentPosition((position) => {
      setCenter({ latitude: position.coords.latitude, longitude: normalizeLongitude(position.coords.longitude) })
      setZoom(14)
      setLocationState('ready')
    }, () => setLocationState('denied'), { maximumAge: 300000, timeout: 8000 })
  }

  return <div className="location-map-workspace">
    <section className="location-map-toolbar">
      <div className="location-map-filters" aria-label="Map filters">{['all', 'saved', 'matched', 'planned'].map((state) => <button type="button" className={filter === state ? 'is-active' : ''} onClick={() => changeFilter(state)} key={state}>{state === 'all' ? 'All places' : stateLabel(state)}<strong>{state === 'all' ? allPoints.length : allPoints.filter((point) => point.states.includes(state)).length}</strong></button>)}</div>
      <div className="location-map-toolbar-actions">
        {passActive ? <button className={`location-map-heatmap-toggle${heatmapEnabled ? ' is-active' : ''}`} type="button" onClick={() => setHeatmapEnabled((value) => !value)} aria-pressed={heatmapEnabled}><span>PASS</span> Heatmap</button> : null}
        <button className="location-map-locate" type="button" onClick={locate} disabled={locationState === 'loading'} aria-busy={locationState === 'loading'}>◎ {locationState === 'loading' ? 'Locating…' : 'Near me'}</button>
      </div>
    </section>
    <div className="location-map-layout">
      <section className="location-map-canvas" ref={mapRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} data-map-zoom={zoom} aria-label="Interactive map of Puddle locations">
        <div className="location-map-pan-layer" ref={panLayerRef}>
          <MapTileLayer center={center} zoom={zoom} viewport={viewport} />
          {passActive && heatmapEnabled ? <div className="location-map-heatmap" aria-label="Pass save density heatmap">{visibleHeatmap.map((point) => {
            const projected = project(point.latitude, point.longitude, zoom)
            const x = projectedXOffset(projected.x, projectedCenter.x, zoom) + viewport.width / 2
            const y = projected.y - projectedCenter.y + viewport.height / 2
            const ratio = Math.max(.12, (Number(point.save_count) || 1) / maxHeat)
            const size = Math.round(34 + ratio * 74)
            return <span className="location-map-heat" title={`${point.name}: ${point.save_count} saves`} style={{ width: `${size}px`, height: `${size}px`, opacity: .2 + ratio * .5, transform: `translate3d(${x}px,${y}px,0) translate(-50%,-50%)` }} key={point.id}><b>{point.save_count}</b></span>
          })}</div> : null}
          <div className="location-map-markers">{markerGroups.map((item) => {
            if (item.type === 'cluster') return <button type="button" className="location-map-cluster" style={{ transform: `translate3d(${item.x}px,${item.y}px,0)` }} onClick={(event) => { if (consumeDragClick(event)) return; event.stopPropagation(); openCluster(item) }} aria-label={`${item.count} locations. Zoom in to explore.`} key={`cluster:${zoom}:${item.key}`}><span>{item.count}</span></button>
            const point = item.point
            const primary = primaryState(point)
            return <button type="button" className={`location-map-marker is-${primary} ${selectedId === point.id ? 'is-selected' : ''}`} style={{ transform: `translate3d(${item.x}px,${item.y}px,0) rotate(-45deg)${selectedId === point.id ? ' scale(1.15)' : ''}` }} onClick={(event) => { if (consumeDragClick(event)) return; event.stopPropagation(); selectPoint(point) }} aria-label={`${point.title}, ${point.states.map(stateLabel).join(', ')}`} key={point.id}><span aria-hidden="true">{primary === 'planned' ? '⌖' : primary === 'matched' ? '♡' : primary === 'catalogue' ? 'P' : '♥'}</span></button>
          })}</div>
        </div>
        <div className="location-map-zoom"><button type="button" onClick={(event) => { event.stopPropagation(); setZoom((value) => clamp(value + 1, MIN_ZOOM, MAX_ZOOM)) }} aria-label="Zoom in">+</button><button type="button" onClick={(event) => { event.stopPropagation(); setZoom((value) => clamp(value - 1, MIN_ZOOM, MAX_ZOOM)) }} aria-label="Zoom out">−</button></div>
        <a className="location-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
        {loadCatalogue && filter === 'all' && catalogueState === 'loading' ? <div className="location-map-status" role="status">Loading locations…</div> : null}
        {loadCatalogue && filter === 'all' && catalogueState === 'error' ? <div className="location-map-status is-error" role="alert"><span>Locations could not be loaded.</span><button type="button" onClick={() => setCatalogueRetry((value) => value + 1)}>Try again</button></div> : null}
        {loadCatalogue && filter === 'all' && catalogueState === 'ready' && !allPoints.length ? <div className="location-map-status" role="status">No Puddle locations in this map area.</div> : null}
        {locationState === 'denied' ? <div className="location-map-status is-error" role="status">Location access was not granted.</div> : null}
        {locationState === 'unavailable' ? <div className="location-map-status is-error" role="status">Location access is unavailable in this browser.</div> : null}
      </section>
      <aside className="location-map-side"><PointCard point={selected} /><div className="location-map-list">{visiblePointItems.map(({ point }) => {
        const primary = primaryState(point)
        return <button type="button" className={selectedId === point.id ? 'is-active' : ''} onClick={() => selectPoint(point)} key={point.id}><span className={`is-${primary}`} aria-hidden="true" /><div><strong>{point.title}</strong><small>{point.neighborhood || point.city || categoryLabel(point.category)}</small></div></button>
      })}</div></aside>
    </div>
  </div>
}

function categoryLabel(value) { return String(value || 'Location').replaceAll('_', ' ') }
