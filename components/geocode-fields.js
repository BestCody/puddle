"use client"

import { useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

export function GeocodeFields({ defaultAddress = '', defaultLatitude = '', defaultLongitude = '' }) {
  const [address, setAddress] = useState(defaultAddress)
  const [latitude, setLatitude] = useState(defaultLatitude ?? '')
  const [longitude, setLongitude] = useState(defaultLongitude ?? '')
  const [message, setMessage] = useState('')

  async function lookup() {
    setMessage('Looking up address…')
    const response = await csrfFetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.result) {
      setMessage(result.error || 'Address lookup failed.')
      return
    }
    setLatitude(String(result.result.latitude))
    setLongitude(String(result.result.longitude))
    setMessage(result.result.label ? `Pinned: ${result.result.label}` : 'Map coordinates added.')
  }

  return (
    <>
      <label className="editor-field span-two">Public address or area<input name="address_public" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Kensington Market, Toronto" /></label>
      <div className="geocode-row span-two">
        <button className="editor-button" type="button" onClick={lookup}>Find map coordinates</button>
        <span>{message || 'You can also enter coordinates manually.'}</span>
      </div>
      <label className="editor-field">Latitude<input name="latitude" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
      <label className="editor-field">Longitude<input name="longitude" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
    </>
  )
}
