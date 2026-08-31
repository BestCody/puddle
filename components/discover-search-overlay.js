"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useModalFocus } from '@/components/modal-focus'

function buildSearchHref(route, fixedParams, query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fixedParams || {})) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  const value = query.trim()
  if (value) params.set('q', value)
  const search = params.toString()
  return search ? `${route}?${search}` : route
}

export function PuddleSearchOverlay({
  initialQuery = '',
  route = '/map',
  fixedParams = {},
  placeholder = 'Search Puddles',
  triggerLabel = 'Search Puddles',
  triggerVisualLabel = null,
  triggerGlyph = '\u2315',
  compactTrigger = true,
  triggerClassName = '',
  overlayClassName = '',
  testId = 'feed-search'
}) {
  const router = useRouter()
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const overlayRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const dialogId = `${testId}-dialog`

  useModalFocus(overlayRef, inputRef, open)

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  function navigate(next) {
    router.replace(buildSearchHref(route, fixedParams, next), { scroll: false })
  }

  function update(next) {
    setQuery(next)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => navigate(next), 260)
  }

  function submit(event) {
    event.preventDefault()
    if (timerRef.current) window.clearTimeout(timerRef.current)
    navigate(query)
  }

  const triggerClass = [compactTrigger ? 'puddle-discover-search-trigger' : '', 'puddle-search-trigger', triggerClassName].filter(Boolean).join(' ')
  const overlayClass = ['puddle-discover-search-overlay', 'puddle-search-overlay', overlayClassName].filter(Boolean).join(' ')

  return <>
    <button className={triggerClass} type="button" onClick={() => setOpen(true)} data-testid={testId} aria-label={triggerLabel} aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={open}>
      <span className="puddle-search-trigger-label">{triggerVisualLabel || triggerLabel}</span><span className="puddle-search-trigger-icon" aria-hidden="true">{triggerGlyph}</span>
    </button>
    <div ref={overlayRef} id={dialogId} className={`${overlayClass}${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label={`${triggerLabel} dialog`} aria-hidden={!open} inert={!open} tabIndex={-1}>
      <button className="puddle-discover-search-backdrop puddle-universal-backdrop" type="button" onClick={() => setOpen(false)} aria-label="Close search" />
      <form className="puddle-discover-search-dialog puddle-search-dialog" role="search" onSubmit={submit}>
        <span className="puddle-search-dialog-icon" aria-hidden="true">⌕</span>
        <input ref={inputRef} type="search" value={query} onChange={(event) => update(event.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
        {query ? <button type="button" onClick={() => update('')} aria-label="Clear search">×</button> : null}
      </form>
    </div>
  </>
}

export function DiscoverSearchOverlay({ initialQuery = '', mapMode = false }) {
  return <PuddleSearchOverlay
    initialQuery={initialQuery}
    fixedParams={mapMode ? { view: 'map' } : {}}
    triggerClassName={mapMode ? 'puddle-map-search-trigger' : ''}
    overlayClassName={mapMode ? '' : 'puddle-feed-search-overlay'}
    testId={mapMode ? 'map-search' : 'feed-search'}
  />
}

export function SavedSearchInput({ initialQuery = '', category = 'all' }) {
  const router = useRouter()
  const timerRef = useRef(null)
  const [query, setQuery] = useState(initialQuery)
  const fixedParams = { tab: 'saved', ...(category !== 'all' ? { category } : {}) }

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  function navigate(next) {
    router.replace(buildSearchHref('/plans', fixedParams, next), { scroll: false })
  }

  function update(next) {
    setQuery(next)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => navigate(next), 260)
  }

  function submit(event) {
    event.preventDefault()
    if (timerRef.current) window.clearTimeout(timerRef.current)
    navigate(query)
  }

  return <form className="puddle-saved-search-input" role="search" aria-label="Search saved puddles" onSubmit={submit} data-testid="saved-search">
    <label>
      <span className="sr-only">Search saved puddles</span>
      <input type="search" value={query} onChange={(event) => update(event.target.value)} placeholder="Search a saved puddle..." aria-label="Search saved puddles" autoComplete="off" />
    </label>
    <button type="submit" aria-label="Apply saved puddle search">↑</button>
  </form>
}
