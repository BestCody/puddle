"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

function queryString(filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== false && value !== null && value !== undefined) params.set(key, String(value))
  return params.toString()
}

function DiscoveryCard({ item, onAction, compact = false }) {
  return <article className={`real-discovery-card ${compact ? 'is-compact' : ''}`}>
    <div className="real-discovery-art" style={{ backgroundImage: item.cover_url ? `linear-gradient(180deg,transparent,rgba(20,14,18,.55)),url(${item.cover_url})` : undefined }}>
      {!item.cover_url ? <strong aria-hidden="true">{item.content_kind === 'event' ? '✦' : '⌖'}</strong> : null}
      <span>{item.kindLabel}</span><em>{Math.round(item.score)} pts</em>
    </div>
    <div className="real-discovery-copy">
      <div className="card-kicker"><span>{String(item.category || '').replaceAll('_', ' ')}</span><span>{item.distanceLabel}</span></div>
      <h2>{item.title}</h2><p>{item.summary || 'Worth a closer look.'}</p>
      <div className="reason-row">{(item.reasons || []).map((reason) => <span key={reason}>{reason}</span>)}</div>
      <div className="card-tags"><span>{item.priceLabel}</span>{item.content_kind === 'event' && item.starts_at ? <span>{new Date(item.starts_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span> : null}</div>
      <div className="real-card-actions">
        <button type="button" onClick={() => onAction('dismissed', item)}>Pass</button>
        <button type="button" onClick={() => onAction('saved', item)}>♡ Save</button>
        <button type="button" onClick={() => onAction('interested', item)}>✦ Interested</button>
        <Link href={item.href} onClick={() => onAction('opened', item)}>Details →</Link>
      </div>
    </div>
  </article>
}

function MapCanvas({ items, onSelect, selectedId }) {
  const points = items.filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
  const bounds = useMemo(() => {
    if (!points.length) return null
    const latitudes = points.map((item) => Number(item.latitude))
    const longitudes = points.map((item) => Number(item.longitude))
    return { minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes), minLng: Math.min(...longitudes), maxLng: Math.max(...longitudes) }
  }, [points])
  if (!bounds) return <div className="map-empty"><strong>No mapped results yet.</strong><span>Add coordinates to places so they can appear here.</span></div>
  return <div className="puddle-map" role="img" aria-label="Map of nearby events and places"><div className="map-grid" aria-hidden="true" />
    {points.map((item) => {
      const left = bounds.maxLng === bounds.minLng ? 50 : ((Number(item.longitude) - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 82 + 9
      const top = bounds.maxLat === bounds.minLat ? 50 : 91 - ((Number(item.latitude) - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 82
      return <button className={`map-marker ${selectedId === item.content_id ? 'is-selected' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} type="button" onClick={() => onSelect(item)} key={`${item.content_kind}-${item.content_id}`} aria-label={item.title}><span>{item.content_kind === 'event' ? '✦' : '⌖'}</span><small>{item.title}</small></button>
    })}
    <div className="map-legend"><span><i className="event-dot" /> Events</span><span><i className="place-dot" /> Places</span></div>
  </div>
}

export function DiscoveryWorkspace({ initialFeed, defaultMode = 'deck' }) {
  const [feed, setFeed] = useState(initialFeed)
  const [filters, setFilters] = useState(initialFeed.filters)
  const [mode, setMode] = useState(defaultMode)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState(initialFeed.items[0] || null)

  async function refresh(nextFilters = filters) {
    setLoading(true);setMessage('')
    const response = await fetch(`/api/discovery?${queryString(nextFilters)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}));setLoading(false)
    if (!response.ok) { setMessage(result.error || 'Discovery could not refresh.');return }
    setFeed(result);setFilters(result.filters);setIndex(0);setSelected(result.items[0] || null)
  }
  function updateFilter(name, value) { setFilters((current) => ({ ...current, [name]: value })) }
  async function useLocation() {
    if (!navigator.geolocation) return setMessage('Location is not available in this browser.')
    setMessage('Finding nearby plans…')
    navigator.geolocation.getCurrentPosition((position) => { const next = { ...filters, latitude: position.coords.latitude, longitude: position.coords.longitude };setFilters(next);refresh(next) }, () => setMessage('Location permission was not granted.'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 })
  }
  async function act(action, item) {
    if (action !== 'opened') setMessage(`${action === 'dismissed' ? 'Passed' : action === 'saved' ? 'Saved' : action === 'visited' ? 'Visited' : 'Interested'} · ${item.title}`)
    const response = await csrfFetch('/api/discovery/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, contentKind: item.content_kind, contentId: item.content_id, requestId: feed.requestId }), keepalive: action === 'opened' })
    if (!response.ok && action !== 'opened') { const result = await response.json().catch(() => ({}));setMessage(result.error || 'That choice could not be saved.');return }
    if (mode === 'deck' && action !== 'opened') setIndex((current) => Math.min(current + 1, Math.max(feed.items.length - 1, 0)))
  }
  async function undo() {
    const item = feed.items[Math.max(0, index - 1)] || feed.items[index]
    if (!item) return
    await csrfFetch('/api/discovery/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', contentKind: item.content_kind, contentId: item.content_id, requestId: feed.requestId }) })
    setIndex((current) => Math.max(0, current - 1));setMessage('Last discovery choice undone.')
  }

  const current = feed.items[index] || null
  return <div className="discovery-workspace">
    <form className="discovery-filter-panel" onSubmit={(event) => { event.preventDefault();refresh() }}>
      <label className="wide">Search<input value={filters.q || ''} onChange={(event) => updateFilter('q', event.target.value)} placeholder="Live music, cafés, parks…" /></label>
      <label>Content<select value={filters.kind} onChange={(event) => updateFilter('kind', event.target.value)}><option value="all">Events + places</option><option value="event">Events</option><option value="place">Places</option></select></label>
      <label>Category<select value={filters.category || ''} onChange={(event) => updateFilter('category', event.target.value)}><option value="">All categories</option>{feed.categories.map((category) => <option value={category} key={category}>{category.replaceAll('_', ' ')}</option>)}</select></label>
      <label>Date<select value={filters.date} onChange={(event) => updateFilter('date', event.target.value)}><option value="any">Any date</option><option value="tonight">Tonight</option><option value="weekend">This weekend</option><option value="next7">Next 7 days</option></select></label>
      <label>Distance<select value={filters.distance} onChange={(event) => updateFilter('distance', Number(event.target.value))}>{[2,5,10,25,50,100].map((value) => <option value={value} key={value}>{value} km</option>)}</select></label>
      <label>Price<select value={filters.price} onChange={(event) => updateFilter('price', event.target.value)}><option value="any">Any price</option><option value="free">Free events</option><option value="1">$ places</option><option value="2">$$ places</option><option value="3">$$$ places</option><option value="4">$$$$ places</option></select></label>
      <label>Amenity<input value={filters.amenity || ''} onChange={(event) => updateFilter('amenity', event.target.value)} placeholder="patio, Wi-Fi…" /></label>
      <label className="check-filter"><input type="checkbox" checked={Boolean(filters.openNow)} onChange={(event) => updateFilter('openNow', event.target.checked)} /> Open now</label>
      <label className="check-filter"><input type="checkbox" checked={Boolean(filters.accessible)} onChange={(event) => updateFilter('accessible', event.target.checked)} /> Accessible</label>
      <label className="check-filter"><input type="checkbox" checked={Boolean(filters.available)} onChange={(event) => updateFilter('available', event.target.checked)} /> Space available</label>
      <div className="filter-actions"><button type="submit">{loading ? 'Searching…' : 'Apply filters'}</button><button type="button" onClick={useLocation}>Use my location</button></div>
    </form>
    <div className="discovery-mode-row"><div className="mode-tabs">{['deck','list','map'].map((value) => <button className={mode === value ? 'is-active' : ''} type="button" onClick={() => setMode(value)} key={value}>{value}</button>)}</div><span>{feed.items.length} result{feed.items.length === 1 ? '' : 's'} · {feed.rankingVersion}{feed.experiment?.variant ? ` · ${feed.experiment.variant}` : ''}</span></div>
    {message ? <p className="discovery-message">{message}</p> : null}
    {feed.fallback ? <div className="demo-data-note">Vector candidate generation is unavailable, so Puddle is using its deterministic rules fallback.</div> : null}
    {mode === 'deck' ? <div className="ranked-deck">{current ? <><DiscoveryCard item={current} onAction={act} /><button className="undo-choice" type="button" onClick={undo}>↶ Undo last choice</button></> : <div className="map-empty"><strong>You reached the end.</strong><button type="button" onClick={() => setIndex(0)}>Start again</button></div>}</div> : null}
    {mode === 'list' ? <div className="real-discovery-list">{feed.items.map((item) => <DiscoveryCard compact item={item} onAction={act} key={`${item.content_kind}-${item.content_id}`} />)}</div> : null}
    {mode === 'map' ? <div className="map-layout"><MapCanvas items={feed.items} onSelect={setSelected} selectedId={selected?.content_id} />{selected ? <DiscoveryCard compact item={selected} onAction={act} /> : null}</div> : null}
  </div>
}
