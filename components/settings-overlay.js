"use client"

import { useEffect, useRef, useState } from 'react'

export const SETTINGS_OPEN_EVENT = 'puddle:settings-open'
export const SETTINGS_CLOSE_EVENT = 'puddle:settings-close'

export function openSettingsOverlay() {
  window.dispatchEvent(new Event(SETTINGS_OPEN_EVENT))
}

export function SettingsOverlay() {
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const frameRef = useRef(null)

  useEffect(() => {
    if (window.self !== window.top) return
    setEnabled(true)

    function openOverlay() {
      setOpen(true)
      document.documentElement.classList.add('puddle-settings-overlay-open')
    }
    function closeOverlay() {
      setOpen(false)
      document.documentElement.classList.remove('puddle-settings-overlay-open')
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') closeOverlay()
    }

    window.addEventListener(SETTINGS_OPEN_EVENT, openOverlay)
    window.addEventListener(SETTINGS_CLOSE_EVENT, closeOverlay)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener(SETTINGS_OPEN_EVENT, openOverlay)
      window.removeEventListener(SETTINGS_CLOSE_EVENT, closeOverlay)
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('puddle-settings-overlay-open')
    }
  }, [])

  function prepareFrame() {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!doc) return
    doc.documentElement.classList.add('puddle-settings-embedded')
    const close = doc.querySelector('.figma-settings-close')
    close?.addEventListener('click', (event) => {
      event.preventDefault()
      window.dispatchEvent(new Event(SETTINGS_CLOSE_EVENT))
    }, { once: true })
    setReady(true)
  }

  if (!enabled) return null

  return <div className={`puddle-settings-overlay${open ? ' is-open' : ''}`} aria-hidden={!open}>
    <button className="puddle-settings-overlay-backdrop" type="button" onClick={() => window.dispatchEvent(new Event(SETTINGS_CLOSE_EVENT))} aria-label="Close settings" />
    <iframe
      ref={frameRef}
      className={`puddle-settings-overlay-frame${ready ? ' is-ready' : ''}`}
      src="/account?returnTo=%2Fprofile"
      title="Settings"
      onLoad={prepareFrame}
    />
  </div>
}
