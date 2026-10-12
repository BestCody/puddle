"use client"
import logoStyles from "@/components/puddle-logo.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { useLayoutEffect, useRef } from 'react'
import { useProductIdentity } from './product-identity'

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

function useAppearanceSync(initialAppearance) {
  const productIdentity = useProductIdentity()
  const appearance = initialAppearance ?? productIdentity?.identity?.appearanceTheme ?? 'system'
  const elementRef = useRef(null)
  useLayoutEffect(() => {
    const shell = elementRef.current?.closest('.figma-dashboard-shell')
    if (!shell) return undefined

    applyAppearance(shell, appearance)

    if (appearance !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemAppearance = () => applyAppearance(shell, 'system')
    media.addEventListener?.('change', syncSystemAppearance)
    return () => media.removeEventListener?.('change', syncSystemAppearance)
  }, [appearance])

  return elementRef
}

export function AppearanceSync({ initialAppearance }) {
  const elementRef = useAppearanceSync(initialAppearance)
  return <span ref={elementRef} hidden aria-hidden="true" />
}

export function AppearanceLogo({ initialAppearance }) {
  const elementRef = useAppearanceSync(initialAppearance)

  return <span
    ref={elementRef}
    className={scopedClasses(logoStyles, "puddle-logo puddle-logo-appearance")}
    role="img"
    aria-label="Puddle"
  >
    <img src="/puddle-mark-outline.svg" alt="" width="44" height="44" />
  </span>
}
