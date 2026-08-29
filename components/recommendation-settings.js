"use client"

import { useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

export function RecommendationSettings({ initialPreferences }) {
  const [preferences, setPreferences] = useState(initialPreferences)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')

  async function request(body) {
    setBusy(true)
    setMessage('')
    try {
      const response = await csrfFetch('/api/recommendations/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Recommendation settings could not be updated.')
      return result
    } finally {
      setBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    try {
      const result = await request({ action: 'save', behavioral: preferences.behavioral_enabled, friendActivity: preferences.friend_activity_enabled, vector: preferences.vector_enabled, explicitInterestsOnly: preferences.explicit_interests_only })
      setPreferences((current) => ({ ...current, ...(result.preferences || {}) }))
      setMessage('Recommendation preferences saved.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function reset() {
    try {
      await request({ action: 'reset' })
      setPreferences({ behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false })
      setMessage('Personalization history reset. New recommendations start from your explicit interests.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function removeData() {
    try {
      await request({ action: 'delete', confirmation })
      setPreferences({ behavioral_enabled: false, friend_activity_enabled: false, vector_enabled: false, explicit_interests_only: true })
      setConfirmation('')
      setMessage('Recommendation logs and preference embeddings were deleted. Operational ticket and attendance records were not changed.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  const toggle = (key) => setPreferences((current) => ({ ...current, [key]: !current[key] }))
  return <div className="recommendation-settings-grid">
    <form className="recommendation-settings-card" onSubmit={save}>
      <span className="section-pill section-pill-mint">Personalization controls</span>
      <h2>Choose which signals shape Discover.</h2>
      <label className="settings-toggle"><input type="checkbox" checked={preferences.behavioral_enabled} onChange={() => toggle('behavioral_enabled')} /><span><strong>Use my Puddle activity</strong><small>Saves, RSVPs, attendance, tickets, visits, and discovery choices.</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={preferences.friend_activity_enabled} onChange={() => toggle('friend_activity_enabled')} /><span><strong>Use permitted friend activity</strong><small>Only activity that friends chose to share with you.</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={preferences.vector_enabled} onChange={() => toggle('vector_enabled')} /><span><strong>Use content similarity</strong><small>Compare local pgvector embeddings generated without an external AI key.</small></span></label>
      <label className="settings-toggle"><input type="checkbox" checked={preferences.explicit_interests_only} onChange={() => toggle('explicit_interests_only')} /><span><strong>Explicit interests only</strong><small>Ignore behavioral history and build recommendations from profile interests.</small></span></label>
      <button type="submit" disabled={busy}>Save preferences</button>
    </form>
    <section className="recommendation-settings-card">
      <span className="section-pill section-pill-yellow">How ranking works</span>
      <h2>Transparent hybrid ranking.</h2>
      <p>Hard safety and availability rules run first. Eligible events and places are then scored from distance, timing, your interests and activity, followed hosts, permitted friend activity, popularity, novelty, diversity, and optional vector similarity.</p>
      <p>Every card explanation comes from a signal that actually contributed to its score. Popularity, friends, and vector similarity are capped so none can control the feed alone.</p>
      <button type="button" className="quiet-button" disabled={busy} onClick={reset}>Reset learned preferences</button>
    </section>
    <section className="recommendation-settings-card recommendation-danger-card">
      <span className="section-pill">Delete recommendation data</span>
      <h2>Remove personalization logs.</h2>
      <p>This deletes recommendation requests, candidates, outcomes, legacy discovery actions and impressions, experiment assignments, and your preference embedding. It does not delete tickets, orders, RSVPs, attendance, visits, security records, or your account.</p>
      <label className="editor-field">Type DELETE<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button type="button" className="danger-link" disabled={busy || confirmation !== 'DELETE'} onClick={removeData}>Delete recommendation data</button>
    </section>
    {message ? <p className="recommendation-settings-message" role="status">{message}</p> : null}
  </div>
}
