"use client"

import { useLayoutEffect, useRef } from 'react'

const PENDING_KEY = 'puddle:appearance-pending'
const EXPLICIT_THEMES = new Set(['light', 'dark'])
const buttonStyle = { width: 56, height: 56, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }

function resolveAppearance(value) {
  if (value === 'dark') return 'dark'
  if (value === 'system' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function applyAppearance(shell, appearance) {
  if (!shell) return
  const resolved = resolveAppearance(appearance)
  shell.dataset.appearance = appearance
  shell.dataset.resolvedAppearance = resolved
  shell.classList.toggle('is-dark', resolved === 'dark')
}

export function AppearanceToggleLogo({ initialAppearance = 'light' }) {
  const buttonRef = useRef(null)

  useLayoutEffect(() => {
    const shell = buttonRef.current?.closest('.figma-dashboard-shell')
    if (!shell) return undefined

    const pending = window.sessionStorage.getItem(PENDING_KEY)
    const appearance = EXPLICIT_THEMES.has(pending) ? pending : initialAppearance
    applyAppearance(shell, appearance)

    if (appearance !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemAppearance = () => applyAppearance(shell, 'system')
    media.addEventListener?.('change', syncSystemAppearance)
    return () => media.removeEventListener?.('change', syncSystemAppearance)
  }, [initialAppearance])

  return <button
    ref={buttonRef}
    type="button"
    className="puddle-logo puddle-logo-theme-toggle"
    style={buttonStyle}
    aria-label="Puddle"
  >
    <img src="/puddle-mark-outline.svg" alt="" width="44" height="44" />
  </button>
}
