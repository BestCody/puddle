"use client"

import { useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'
import { TurnstileWidget } from './turnstile-widget'
import styles from './appeal-card.module.css'

export function AppealForm() {
  const [caseNumber, setCaseNumber] = useState('')
  const [statement, setStatement] = useState('')
  const [challengeAttempt, setChallengeAttempt] = useState(0)
  const [turnstile, setTurnstile] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setMessage('')
    try {
      const response = await csrfFetch('/api/appeals', {
        method: 'POST',
        retryCsrf: false,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseNumber: caseNumber.trim(), statement: statement.trim(), turnstileToken: turnstile })
      })
      const payload = await response.json().catch(() => ({}))
      setMessage(response.ok ? 'Appeal submitted.' : payload.error || 'Appeal could not be submitted.')
    } catch {
      setMessage('Appeal could not be submitted. Please try again; your statement is still here.')
    } finally {
      setTurnstile('')
      setChallengeAttempt(value => value + 1)
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
      <TurnstileWidget key={challengeAttempt} action="submit_appeal" onToken={setTurnstile} />
      <button type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit appeal'}</button>
    </form>
    <p role="status">{message}</p>
  </section>
}
