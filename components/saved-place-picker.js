'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './saved-place-picker.module.css'

// All attach/share surfaces use the indexed Saved search and cursor pages.
export function SavedPlacePicker({ selectedId, onSelect, disabled = false, autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef(null)
  const search = useRef('')

  async function load(q, cursor = '') {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ q })
      if (cursor) params.set('cursor', cursor)
      const response = await fetch(`/api/saved-page?${params}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('Saved places unavailable')
      const page = await response.json()
      if (!Array.isArray(page.items)) throw new Error('Invalid Saved page')
      if (controller.signal.aborted || search.current !== q) return
      setItems(previous => cursor ? [...new Map([...previous, ...page.items].map(item => [item.location_id || item.id, item])).values()] : page.items)
      setPagination(page.pagination)
    } catch {
      if (!controller.signal.aborted) setError('Saved places could not be loaded. Try again.')
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false) }
    }
  }

  useEffect(() => {
    search.current = query.trim()
    request.current?.abort()
    request.current = null
    setItems([])
    setPagination(null)
    setLoading(true)
    const timer = setTimeout(() => { void load(search.current) }, query ? 250 : 0)
    return () => { clearTimeout(timer); request.current?.abort(); request.current = null }
  }, [query, retry])

  return <div className={styles.picker}>
    <input type="search" aria-label="Search saved places" placeholder="Search saved places…" maxLength={100} autoFocus={autoFocus} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
    <div className={styles.results}>{items.map(item => <button type="button" key={item.location_id || item.id} disabled={disabled} aria-pressed={selectedId === (item.location_id || item.id)} onClick={() => onSelect({ ...item, id: item.location_id || item.id, name: item.title, photo_url: item.cover_path })}><strong>{item.title}</strong><small>{item.city || String(item.category || 'Saved place').replaceAll('_', ' ')}</small></button>)}</div>
    {loading ? <p role="status">Loading saved places…</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={() => pagination?.nextCursor ? load(search.current, pagination.nextCursor) : setRetry(value => value + 1)}>Try again</button></p> : null}
    {!loading && !error && !items.length ? <p>{query ? 'No saved places match this search.' : 'No saved places yet.'}</p> : null}
    {pagination?.hasMore ? <button type="button" disabled={loading || disabled} onClick={() => load(search.current, pagination.nextCursor)}>More saved places</button> : null}
  </div>
}
