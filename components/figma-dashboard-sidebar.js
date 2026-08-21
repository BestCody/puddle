"use client"

import { useEffect, useRef, useState } from 'react'
import { AppearanceToggleLogo } from './appearance-toggle-logo'
import { ProductNav } from './product-nav'
import { SettingsTrigger } from './settings-trigger'

const STORAGE_KEY = 'puddle:figma-dashboard-sidebar-width'
const EXPANDED_WIDTH = 280
const CONCISE_WIDTH = 102
const EXPANDED_THRESHOLD = 190

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
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
}

export function FigmaDashboardSidebar({ avatarUrl = null, initialAppearance = 'light' }) {
  const [width, setWidth] = useState(EXPANDED_WIDTH)
  const [resizing, setResizing] = useState(false)
  const drag = useRef(null)
  const concise = width === CONCISE_WIDTH

  useEffect(() => {
    const saved = snapWidth(window.localStorage.getItem(STORAGE_KEY))
    setWidth(saved)
    applyWidth(saved)
    return () => document.documentElement.style.removeProperty('--figma-shell-sidebar')
  }, [])

  function commit(next) {
    const snapped = snapWidth(next)
    setWidth(snapped)
    applyWidth(snapped)
    window.localStorage.setItem(STORAGE_KEY, String(snapped))
  }

  function beginResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
    setResizing(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveResize(event) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const raw = Math.max(CONCISE_WIDTH, Math.min(EXPANDED_WIDTH, state.startWidth + event.clientX - state.startX))
    setWidth(raw)
    applyWidth(raw)
  }

  function finishResize(event) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(false)
    commit(width)
  }

  function keyboardResize(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft' || event.key === 'Home') commit(CONCISE_WIDTH)
    else commit(EXPANDED_WIDTH)
  }

  return <aside className={`figma-dashboard-sidebar${concise ? ' is-concise' : ' is-expanded'}${resizing ? ' is-resizing' : ''}`} aria-label="Puddle sidebar" data-sidebar-width={width}>
    <div className="figma-dashboard-sidebar-logo"><AppearanceToggleLogo initialAppearance={initialAppearance} /></div>
    <ProductNav avatarUrl={avatarUrl} />
    <SettingsTrigger className="figma-dashboard-settings-link">
      <span className="figma-dashboard-settings-icon"><SettingsIcon /></span>
      <span className="figma-dashboard-settings-label">Settings</span>
    </SettingsTrigger>
    <div
      className="figma-dashboard-sidebar-resizer"
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-orientation="vertical"
      aria-valuemin={CONCISE_WIDTH}
      aria-valuemax={EXPANDED_WIDTH}
      aria-valuenow={Math.round(width)}
      aria-valuetext={concise ? 'Concise navigation' : 'Expanded navigation'}
      tabIndex={0}
      onPointerDown={beginResize}
      onPointerMove={moveResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={keyboardResize}
    />
  </aside>
}
