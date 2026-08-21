"use client"

import { useEffect, useRef, useState } from 'react'
import { PuddleLogo } from './puddle-logo'
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

export function FigmaDashboardSidebar({ avatarUrl = null }) {
  const [width, setWidth] = useState(EXPANDED_WIDTH)
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
    commit(width)
  }

  function keyboardResize(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft' || event.key === 'Home') commit(CONCISE_WIDTH)
    else commit(EXPANDED_WIDTH)
  }

  return <aside className={`figma-dashboard-sidebar${concise ? ' is-concise' : ' is-expanded'}`} aria-label="Puddle sidebar" data-sidebar-width={width}>
    <div className="figma-dashboard-sidebar-logo"><PuddleLogo compact href="/discover" variant="outline" /></div>
    <ProductNav avatarUrl={avatarUrl} />
    <SettingsTrigger className="figma-dashboard-settings-link">Settings</SettingsTrigger>
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
