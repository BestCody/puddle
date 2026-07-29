"use client"

import { useEffect, useRef, useState } from 'react'

const QUEUE_KEY = 'puddle-offline-checkins-v1'
const DEVICE_KEY = 'puddle-checkin-device-v1'

function bytesFromBase64(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)) }
function bytesFromBase64Url(value) { return bytesFromBase64(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')) }
function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] } }
function saveQueue(value) { localStorage.setItem(QUEUE_KEY, JSON.stringify(value.slice(-500))) }
function deviceId() { let value = localStorage.getItem(DEVICE_KEY); if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value) } return value }

async function verifyOffline(token, publicKeyBase64, eventId) {
  if (!publicKeyBase64 || !crypto.subtle) return { valid: false, reason: 'Offline verification is unavailable on this device.' }
  const parts = String(token || '').split('.')
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== 'puddle-ticket.v1') return { valid: false, reason: 'Not a Puddle ticket.' }
  try {
    const key = await crypto.subtle.importKey('spki', bytesFromBase64(publicKeyBase64), { name: 'Ed25519' }, false, ['verify'])
    const signingInput = new TextEncoder().encode(`puddle-ticket.v1.${parts[2]}`)
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, bytesFromBase64Url(parts[3]), signingInput)
    const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(parts[2])))
    if (!valid || payload.aud !== 'puddle-checkin' || payload.eid !== eventId) return { valid: false, reason: 'Ticket signature or event does not match.' }
    return { valid: true, payload }
  } catch { return { valid: false, reason: 'Ticket signature could not be verified.' } }
}

export function CheckInScanner({ eventId, publicKeyBase64, initialDashboard }) {
  const scannerRef = useRef(null)
  const [message, setMessage] = useState('Ready to scan.')
  const [history, setHistory] = useState(initialDashboard?.recent || [])
  const [offlineCount, setOfflineCount] = useState(0)
  const [manualQuery, setManualQuery] = useState('')
  const [manualResults, setManualResults] = useState([])

  useEffect(() => { setOfflineCount(loadQueue().length); syncQueue(); return () => { scannerRef.current?.stop?.().catch(() => {}) } }, [])

  async function submitScans(scans) {
    const response = await fetch('/api/check-in/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, deviceId: deviceId(), scans }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Check-in sync failed.')
    setHistory((current) => [...(result.results || []).map((item) => ({ ...item, created_at: new Date().toISOString() })), ...current].slice(0, 50))
    return result.results || []
  }

  async function handleToken(token) {
    const scan = { token: String(token).trim(), scanId: crypto.randomUUID(), scannedAt: new Date().toISOString(), offline: !navigator.onLine }
    if (!navigator.onLine) {
      const verification = await verifyOffline(scan.token, publicKeyBase64, eventId)
      if (!verification.valid) { setMessage(verification.reason); return }
      const queue = [...loadQueue(), scan]; saveQueue(queue); setOfflineCount(queue.length); setMessage(`Offline ticket verified and queued · ${verification.payload.num}`); return
    }
    try { const results = await submitScans([scan]); const first = results[0]; setMessage(first?.message || first?.status || 'Scan processed.') } catch (error) { setMessage(error.message) }
  }

  async function syncQueue() {
    if (!navigator.onLine) return
    const queue = loadQueue(); if (!queue.length) { setOfflineCount(0); return }
    try { await submitScans(queue); saveQueue([]); setOfflineCount(0); setMessage(`${queue.length} offline scan${queue.length === 1 ? '' : 's'} synchronized.`) } catch (error) { setMessage(error.message) }
  }

  async function startCamera() {
    setMessage('Starting camera…')
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (scannerRef.current) await scannerRef.current.stop().catch(() => {})
      const scanner = new Html5Qrcode('puddle-camera-reader'); scannerRef.current = scanner
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 260 } }, (decoded) => handleToken(decoded), () => {})
      setMessage('Camera active. Point it at a Puddle ticket QR code.')
    } catch { setMessage('Camera scanning is unavailable. Use manual token entry or lookup.') }
  }

  async function lookup() {
    const response = await fetch(`/api/check-in/lookup?eventId=${encodeURIComponent(eventId)}&q=${encodeURIComponent(manualQuery)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setManualResults(response.ok ? result.results || [] : []); if (!response.ok) setMessage(result.error || 'Lookup failed.')
  }

  async function reverse(checkinId) {
    const response = await fetch('/api/check-in/reverse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, checkinId, reason: 'Staff reversal' }) })
    const result = await response.json().catch(() => ({})); setMessage(response.ok ? 'Check-in reversed.' : result.error || 'Reversal failed.')
  }

  return <div className="scanner-layout"><section className="finance-card scanner-card"><div className="finance-heading"><div><span className="section-pill section-pill-yellow">Door tools</span><h2>Scan signed tickets.</h2></div><span>{offlineCount} queued offline</span></div><div id="puddle-camera-reader" className="camera-reader" /><div className="finance-actions"><button onClick={startCamera}>Start camera</button><button className="quiet-button" onClick={syncQueue}>Sync offline queue</button></div><label>Paste signed ticket token<textarea rows="4" placeholder="puddle-ticket.v1…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleToken(event.currentTarget.value); event.currentTarget.value = '' } }} /></label><p className="discovery-message">{message}</p><small>Duplicate scans and replaced ticket codes are recorded with a warning instead of creating a second check-in.</small></section>
    <section className="finance-card"><span className="section-pill section-pill-mint">Manual lookup</span><h2>Find a ticket.</h2><div className="ticket-checkout-row"><input value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Name, ticket number, or order" /><button onClick={lookup}>Search</button></div><div className="finance-list">{manualResults.map((item) => <div key={item.ticket_id}><span>{item.status}</span><strong>{item.ticket_number} · {item.owner_name}</strong><small>{item.tier_name}</small>{item.signed_token ? <button onClick={() => handleToken(item.signed_token)}>Check in</button> : null}</div>)}</div></section>
    <section className="finance-card span-two"><span className="section-pill">Audit history</span><h2>Recent scans</h2><div className="finance-list">{history.map((item, index) => <div key={item.checkin_id || item.id || index}><span>{item.status || item.result}</span><strong>{item.ticket_number || item.message || 'Ticket scan'}</strong><small>{item.created_at ? new Date(item.created_at).toLocaleString('en-CA') : ''}</small>{item.checkin_id && item.status === 'checked_in' ? <button className="quiet-button" onClick={() => reverse(item.checkin_id)}>Reverse</button> : null}</div>)}</div></section></div>
}
