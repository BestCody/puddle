"use client"
import publicStyles from "@/components/public-places.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

export function ContentActionButton({ contentKind, contentId, action = 'saved', children }) {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const requestRef = useRef(null)
  const savingRef = useRef(false)
  async function act() {
    if (savingRef.current) return
    savingRef.current = true
    setPending(true)
    setMessage('Saving…')
    // Retain the event ID on a retry: an interrupted response must not record
    // the same choice twice if it already reached the server.
    try {
      requestRef.current ||= crypto.randomUUID()
      const response = await csrfFetch('/api/discovery/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: [{ action, contentKind, contentId, eventId: requestRef.current, context: { source: 'public_place' } }] })
      })
      if (response.status === 401) {
        window.location.assign(`/landing.html?mode=login&next=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`)
        return
      }
      const result = await response.json()
      setMessage(response.ok && result.ok ? (action === 'saved' ? 'Saved ✓' : 'Added ✓') : result.error || 'Try again')
    } catch {
      setMessage('Could not save. Try again.')
    } finally {
      savingRef.current = false
      setPending(false)
    }
  }
  return <button className={scopedClasses(publicStyles, "public-cta")} type="button" onClick={act} disabled={pending} aria-busy={pending}>{message || children}</button>
}
