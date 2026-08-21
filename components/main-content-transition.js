"use client"

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export const MAIN_CONTENT_LOADING_EVENT = 'puddle:main-content-loading'
const SPINNER_DELAY_MS = 140

export function beginMainContentLoading() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MAIN_CONTENT_LOADING_EVENT))
  }
}

function Spinner() {
  return (
    <svg className="puddle-main-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.16" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

export function MainContentTransition({ children }) {
  const pathname = usePathname()
  const timerRef = useRef(null)
  const [loading, setLoading] = useState(false)

  function clearLoadingTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    clearLoadingTimer()
    setLoading(false)
  }, [pathname])

  useEffect(() => {
    function startLoading() {
      clearLoadingTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setLoading(true)
      }, SPINNER_DELAY_MS)
    }

    window.addEventListener(MAIN_CONTENT_LOADING_EVENT, startLoading)
    return () => {
      window.removeEventListener(MAIN_CONTENT_LOADING_EVENT, startLoading)
      clearLoadingTimer()
    }
  }, [])

  return (
    <div className={`puddle-main-transition${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
      <div className="puddle-main-transition-content">{children}</div>
      {loading ? (
        <div className="puddle-main-transition-loader" role="status" aria-label="Loading">
          <Spinner />
        </div>
      ) : null}
    </div>
  )
}
