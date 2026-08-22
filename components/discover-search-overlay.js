"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export function DiscoverSearchOverlay({ initialQuery = '' }) {
  const router = useRouter()
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    if (!open) return undefined
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  function update(next) {
    setQuery(next)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      const value = next.trim()
      router.replace(value ? `/map?q=${encodeURIComponent(value)}` : '/map', { scroll: false })
    }, 260)
  }

  function submit(event) {
    event.preventDefault()
    if (timerRef.current) window.clearTimeout(timerRef.current)
    const value = query.trim()
    router.replace(value ? `/map?q=${encodeURIComponent(value)}` : '/map', { scroll: false })
  }

  return <>
    <button className="puddle-discover-search-trigger" type="button" onClick={() => setOpen(true)} data-testid="feed-search" aria-haspopup="dialog" aria-expanded={open}>
      <span>Search Puddles</span><b aria-hidden="true">⌕</b>
    </button>
    <div className={`puddle-discover-search-overlay${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <button className="puddle-discover-search-backdrop" type="button" onClick={() => setOpen(false)} aria-label="Close search" />
      <form className="puddle-discover-search-dialog" role="search" onSubmit={submit}>
        <span aria-hidden="true">⌕</span>
        <input ref={inputRef} type="search" value={query} onChange={(event) => update(event.target.value)} placeholder="Search Puddles" aria-label="Search Puddles" autoComplete="off" />
        {query ? <button type="button" onClick={() => update('')} aria-label="Clear search">×</button> : null}
      </form>
    </div>
  </>
}
