"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PuddleLogo } from './puddle-logo'
import { ProductNav } from './product-nav'

const STORAGE_KEY = 'puddle:figma-dashboard-sidebar-width'
const EXPANDED_WIDTH = 280
const CONCISE_WIDTH = 102
const EXPANDED_THRESHOLD = 190
const AUTO_CONCISE_QUERY = '(min-width: 761px) and (max-width: 1180px)'

function snapWidth(value) {
  if (value === null || value === undefined || value === '') return EXPANDED_WIDTH
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return EXPANDED_WIDTH
  return numeric < EXPANDED_THRESHOLD ? CONCISE_WIDTH : EXPANDED_WIDTH
}

function applyWidth(value) {
  document.documentElement.style.setProperty('--figma-shell-sidebar', `${value}px`)
}

function SettingsIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="4" />
    <path d="M16 4.5v3M16 24.5v3M4.5 16h3M24.5 16h3M7.9 7.9l2.1 2.1M22 22l2.1 2.1M24.1 7.9 22 10M10 22l-2.1 2.1" />
    <circle cx="16" cy="16" r="9" />
  </svg>
}

export function FigmaDashboardSidebar({ avatarUrl = null }) {
  const [width, setWidth] = useState(EXPANDED_WIDTH)
  const [autoConcise, setAutoConcise] = useState(false)
  const drag = useRef(null)
  const pathname = usePathname()
  const effectiveWidth = autoConcise ? CONCISE_WIDTH : width
  const concise = effectiveWidth < EXPANDED_THRESHOLD
  const returnTo = pathname && pathname !== '/account' ? pathname : '/profile'

  useEffect(() => {
    const saved = snapWidth(window.localStorage.getItem(STORAGE_KEY))
    const media = window.matchMedia(AUTO_CONCISE_QUERY)
    setWidth(saved)
    setAutoConcise(media.matches)

    const syncResponsiveState = (event) => setAutoConcise(event.matches)
    media.addEventListener?.('change', syncResponsiveState)
    return () => {
      media.removeEventListener?.('change', syncResponsiveState)
      document.documentElement.style.removeProperty('--figma-shell-sidebar')
    }
  }, [])

  useEffect(() => {
    applyWidth(effectiveWidth)
  }, [effectiveWidth])

  function commit(next) {
    const snapped = snapWidth(next)
    setWidth(snapped)
    window.localStorage.setItem(STORAGE_KEY, String(snapped))
  }

  function beginResize(event) {
    if (event.button !== 0 || autoConcise) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveResize(event) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const raw = Math.max(CONCISE_WIDTH, Math.min(EXPANDED_WIDTH, state.startWidth + event.clientX - state.startX))
    setWidth(raw)
  }

  function finishResize(event) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const raw = Math.max(CONCISE_WIDTH, Math.min(EXPANDED_WIDTH, state.startWidth + event.clientX - state.startX))
    drag.current = null
    commit(raw)
  }

  function keyboardResize(event) {
    if (autoConcise || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft' || event.key === 'Home') commit(CONCISE_WIDTH)
    else commit(EXPANDED_WIDTH)
  }

  return <aside className={`figma-dashboard-sidebar${concise ? ' is-concise' : ' is-expanded'}`} aria-label="Puddle sidebar" data-sidebar-width={effectiveWidth}>
    <div className="figma-dashboard-sidebar-logo"><PuddleLogo compact href="/discover" variant="outline" /></div>
    <ProductNav avatarUrl={avatarUrl} />
    <Link className="figma-dashboard-settings-link" href={`/account?returnTo=${encodeURIComponent(returnTo)}`} aria-label="Settings">
      <span className="figma-dashboard-settings-icon"><SettingsIcon /></span>
      <span className="figma-dashboard-settings-label">Settings</span>
    </Link>
    <div
      className="figma-dashboard-sidebar-resizer"
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-orientation="vertical"
      aria-valuemin={CONCISE_WIDTH}
      aria-valuemax={EXPANDED_WIDTH}
      aria-valuenow={Math.round(effectiveWidth)}
      aria-valuetext={concise ? 'Concise navigation' : 'Expanded navigation'}
      tabIndex={autoConcise ? -1 : 0}
      onPointerDown={beginResize}
      onPointerMove={moveResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={keyboardResize}
    />
  </aside>
}
