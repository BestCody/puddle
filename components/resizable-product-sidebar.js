"use client"

import { useEffect, useRef, useState } from 'react'
import { PuddleLogo } from './puddle-logo'
import { ProductNav } from './product-nav'

const STORAGE_KEY = 'puddle:product-sidebar-width'
const MIN_WIDTH = 76
const MAX_WIDTH = 300
const EXPANDED_WIDTH = 156

function clampWidth(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return MIN_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(parsed)))
}

function applyWidth(value) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--minimal-sidebar-width', `${clampWidth(value)}px`)
}

export function ResizableProductSidebar({ className = 'minimal-product-sidebar' }) {
  const [width, setWidth] = useState(MIN_WIDTH)
  const drag = useRef(null)

  useEffect(() => {
    const stored = clampWidth(window.localStorage.getItem(STORAGE_KEY))
    setWidth(stored)
    applyWidth(stored)
    return () => document.documentElement.style.removeProperty('--minimal-sidebar-width')
  }, [])

  function updateWidth(value, { persist = false } = {}) {
    const next = clampWidth(value)
    setWidth(next)
    applyWidth(next)
    if (drag.current) drag.current.currentWidth = next
    if (persist) window.localStorage.setItem(STORAGE_KEY, String(next))
  }

  function finishResize(event) {
    if (!drag.current || (event?.pointerId !== undefined && event.pointerId !== drag.current.pointerId)) return
    const finalWidth = drag.current.currentWidth
    drag.current = null
    document.body.classList.remove('is-resizing-product-sidebar')
    if (Number.isFinite(finalWidth)) window.localStorage.setItem(STORAGE_KEY, String(finalWidth))
  }

  function beginResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      currentWidth: width
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-product-sidebar')
  }

  function moveResize(event) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    updateWidth(state.startWidth + event.clientX - state.startX)
  }

  function resizeWithKeyboard(event) {
    let next = null
    if (event.key === 'ArrowLeft') next = width - 12
    if (event.key === 'ArrowRight') next = width + 12
    if (event.key === 'Home') next = MIN_WIDTH
    if (event.key === 'End') next = MAX_WIDTH
    if (next === null) return
    event.preventDefault()
    updateWidth(next, { persist: true })
  }

  const expanded = width >= EXPANDED_WIDTH

  return <aside className={`product-sidebar ${className}${expanded ? ' is-expanded' : ''}`}>
    <div className="minimal-sidebar-logo"><PuddleLogo compact href="/discover" /></div>
    <ProductNav />
    <div
      className="minimal-sidebar-resizer"
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={beginResize}
      onPointerMove={moveResize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={resizeWithKeyboard}
    >
      <span aria-hidden="true" />
    </div>
  </aside>
}
