"use client"

import { useEffect, useState } from 'react'
import { TurnstileWidget } from './turnstile-widget'
import styles from './appeal-card.module.css'

async function csrf() {
  const response = await fetch('/api/security/csrf', { cache: 'no-store' })
  return (await response.json()).token
}

export function AppealForm() {
  const [caseNumber, setCaseNumber] = useState('')
  const [statement, setStatement] = useState('')
  const [token, setToken] = useState('')
  const [turnstile, setTurnstile] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => { csrf().then(setToken).catch(() => {}) }, [])

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setMessage('')
    try {
      const response = await fetch('/api/appeals', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-puddle-csrf': token },
        body: JSON.stringify({ caseNumber: caseNumber.trim(), statement: statement.trim(), turnstileToken: turnstile })
      })
      const payload = await response.json().catch(() => ({}))
      setMessage(response.ok ? 'Appeal submitted.' : payload.error || 'Appeal could not be submitted.')
    } catch {
      setMessage('Appeal could not be submitted. Please try again; your statement is still here.')
    } finally {
      setPending(false)
    }
  }

  return <section className={styles.card}>
    <h2>Submit an appeal</h2>
    <form onSubmit={submit}>
      <label>Case number<input value={caseNumber} onChange={(event) => setCaseNumber(event.target.value.slice(0, 32))} required minLength={4} maxLength={32} pattern="PDL-[A-Za-z0-9-]+" placeholder="PDL-…" /></label>
      <small className={styles.hint}>Use the PDL case number from your moderation notice.</small>
      <label>Statement<textarea value={statement} onChange={(event) => setStatement(event.target.value)} required minLength={20} maxLength={5000} /></label>
      <small className={styles.hint}>20–5,000 characters.</small>
      <TurnstileWidget action="submit_appeal" onToken={setTurnstile} />
      <button type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit appeal'}</button>
    </form>
    <p role="status">{message}</p>
  </section>
}
