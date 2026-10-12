"use client"
import settingsStyles from "@/components/settings.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProductIdentity } from './product-identity'

export const SETTINGS_OPEN_EVENT = 'puddle:settings-open'
export const SETTINGS_CLOSE_EVENT = 'puddle:settings-close'

const FRAME_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function frameFocusable(document) {
  return [...document.querySelectorAll(FRAME_FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false
    const style = document.defaultView?.getComputedStyle(element)
    return style?.display !== 'none' && style?.visibility !== 'hidden'
  })
}

export function openSettingsOverlay(section = 'profile', anchor = '') {
  window.dispatchEvent(new CustomEvent(SETTINGS_OPEN_EVENT, { detail: { section, anchor } }))
}

export function SettingsOverlay() {
  const router = useRouter()
  const productIdentity = useProductIdentity()
  const refreshIdentity = productIdentity?.refresh
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [section, setSection] = useState('profile')
  const [anchor, setAnchor] = useState('')
  const openRef = useRef(false)
  const overlayRef = useRef(null)
  const frameRef = useRef(null)
  const frameCleanupRef = useRef(null)

  const closeOverlay = useCallback(() => {
    const wasOpen = openRef.current
    openRef.current = false
    setOpen(false)
    setFrameLoaded(false)
    frameCleanupRef.current?.()
    frameCleanupRef.current = null
    document.documentElement.classList.remove('puddle-settings-overlay-open')
    if (wasOpen) {
      void refreshIdentity?.()
      router.refresh()
    }
  }, [refreshIdentity, router])

  function requestClose() { closeOverlay() }

  useEffect(() => {
    if (window.self !== window.top) return
    setEnabled(true)

    function openOverlay(event) {
      openRef.current = true
      setSection(event.detail?.section || 'profile')
      setAnchor(event.detail?.anchor || '')
      setFrameLoaded(false)
      setOpen(true)
      document.documentElement.classList.add('puddle-settings-overlay-open')
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') closeOverlay()
    }

    window.addEventListener(SETTINGS_OPEN_EVENT, openOverlay)
    window.addEventListener(SETTINGS_CLOSE_EVENT, closeOverlay)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      frameCleanupRef.current?.()
      frameCleanupRef.current = null
      window.removeEventListener(SETTINGS_OPEN_EVENT, openOverlay)
      window.removeEventListener(SETTINGS_CLOSE_EVENT, closeOverlay)
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('puddle-settings-overlay-open')
    }
  }, [closeOverlay])

  useEffect(() => {
    if (!open) return undefined
    const overlay = overlayRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const siblings = overlay?.parentElement
      ? [...overlay.parentElement.children].filter((element) => element !== overlay)
      : []
    const inertState = siblings.map((element) => ({ element, inert: element.inert }))
    siblings.forEach((element) => { element.inert = true })
    const frame = frameRef.current
    const focusFrame = window.requestAnimationFrame(() => {
      const close = frame?.contentDocument?.querySelector('.figma-settings-close')
      if (close) close.focus({ preventScroll: true })
      else overlay?.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusFrame)
      inertState.forEach(({ element, inert }) => { element.inert = inert })
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  function prepareFrame() {
    frameCleanupRef.current?.()
    frameCleanupRef.current = null
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!doc) return
    setFrameLoaded(true)
    const close = doc.querySelector('.figma-settings-close')
    const closeFromFrame = (event) => {
      event.preventDefault()
      requestClose()
    }
    const handleFrameKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const elements = frameFocusable(doc)
      if (!elements.length) return
      const first = elements[0]
      const last = elements.at(-1)
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    close?.addEventListener('click', closeFromFrame)
    doc.addEventListener('keydown', handleFrameKeyDown)
    const focusClose = open ? window.requestAnimationFrame(() => close?.focus({ preventScroll: true })) : null
    frameCleanupRef.current = () => {
      close?.removeEventListener('click', closeFromFrame)
      doc.removeEventListener('keydown', handleFrameKeyDown)
      if (focusClose !== null) window.cancelAnimationFrame(focusClose)
    }
  }

  if (!enabled) return null

  return <div ref={overlayRef} className={scopedClasses(settingsStyles, `puddle-settings-overlay${open ? ' is-open' : ''}`)} role="dialog" aria-modal="true" aria-label="Settings" aria-hidden={!open} inert={!open} tabIndex={-1}>
    <button className={scopedClasses(settingsStyles, "puddle-settings-overlay-backdrop")} type="button" onClick={requestClose} aria-label="Close settings" tabIndex={-1} />
    {open && !frameLoaded ? <div className={scopedClasses(settingsStyles, "puddle-settings-overlay-frame")} role="status"><span className={scopedClasses(settingsStyles, "puddle-settings-overlay-loading-text")}>Loading settings…</span></div> : null}
    {open ? <iframe
      ref={frameRef}
      className={scopedClasses(settingsStyles, `puddle-settings-overlay-frame${frameLoaded ? '' : ' is-loading'}`)}
      src={`/account?embedded=1&section=${encodeURIComponent(section)}&returnTo=%2Fprofile${anchor ? `#${encodeURIComponent(anchor)}` : ''}`}
      title="Settings"
      tabIndex={frameLoaded ? 0 : -1}
      onLoad={prepareFrame}
    /> : null}
  </div>
}
