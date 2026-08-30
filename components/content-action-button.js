"use client"

import { useState } from 'react'

export function ContentActionButton({ contentKind, contentId, action = 'saved', children }) {
  const [message, setMessage] = useState('')
  async function act() {
    setMessage('Saving…')
    const response = await fetch('/api/discovery/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, contentKind, contentId })
    })
    if (response.status === 401) {
      window.location.assign(`/?next=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    const result = await response.json().catch(() => ({}))
    setMessage(response.ok ? (action === 'saved' ? 'Saved ✓' : 'Added ✓') : result.error || 'Try again')
  }
  return <button className="public-cta" type="button" onClick={act}>{message || children}</button>
}
