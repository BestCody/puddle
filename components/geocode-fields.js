"use client"
import editorStyles from "@/components/location-editor.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

export function GeocodeFields({ defaultAddress = '', defaultLatitude = '', defaultLongitude = '' }) {
  const [address, setAddress] = useState(defaultAddress)
  const [latitude, setLatitude] = useState(defaultLatitude ?? '')
  const [longitude, setLongitude] = useState(defaultLongitude ?? '')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const latestAddress = useRef(defaultAddress)

  async function lookup() {
    if (pending || !address.trim()) return
    const requestedAddress = address.trim()
    setPending(true)
    setMessage('Looking up address…')
    try {
      const response = await csrfFetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: requestedAddress })
      })
      const result = await response.json().catch(() => ({}))
      if (latestAddress.current.trim() !== requestedAddress) {
        setMessage('The address changed. Find its coordinates again.')
        return
      }
      if (!response.ok || !result.result) {
        setMessage(result.error || 'Address lookup failed.')
        return
      }
      setLatitude(String(result.result.latitude))
      setLongitude(String(result.result.longitude))
      setMessage(result.result.label ? `Pinned: ${result.result.label}` : 'Map coordinates added.')
    } catch {
      setMessage('Address lookup could not be completed. Try again or enter coordinates manually.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <label className={scopedClasses(editorStyles, "editor-field span-two")}>Public address or area<input name="address_public" value={address} onChange={event => { latestAddress.current = event.target.value; setAddress(event.target.value) }} placeholder="Kensington Market, Toronto" /></label>
      <div className={scopedClasses(editorStyles, "geocode-row span-two")}>
        <button className={scopedClasses(editorStyles, "editor-button")} type="button" onClick={lookup} disabled={pending || !address.trim()}>{pending ? 'Finding coordinates…' : 'Find map coordinates'}</button>
        <span role="status">{message || 'You can also enter coordinates manually.'}</span>
      </div>
      <label className={scopedClasses(editorStyles, "editor-field")}>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
      <label className={scopedClasses(editorStyles, "editor-field")}>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
    </>
  )
}
