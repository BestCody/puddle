"use client"

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { requestEventPublication, saveEventDraft, transitionEventStatus } from '@/app/create/actions'
import { csrfFetch } from '@/lib/security/csrf-client'
import { accessibilityValue, contactValue, formatDateTimeLocal, listText } from './editor-shared'
import { RevisionHistory } from './revision-history'

const timezones = ['America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','UTC']

export function EventEditor({ event = null, identities = [], locations = [], categories = [] }) {
  const formRef = useRef(null)
  const [draftId, setDraftId] = useState(event?.id || '')
  const [autosave, setAutosave] = useState(event?.id ? 'Saved draft loaded' : 'Start typing to create a draft')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!version || !formRef.current) return
    const timer = window.setTimeout(async () => {
      const formData = new FormData(formRef.current)
      const payload = Object.fromEntries(formData.entries())
      payload.id = draftId
      setAutosave('Saving…')
      try {
        const response = await csrfFetch('/api/drafts/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const result = await response.json()
        if (!response.ok || !result.saved) {
          setAutosave(result.waiting ? 'Add the required basics to autosave' : result.error || 'Autosave paused')
          return
        }
        if (!draftId && result.draft?.id) {
          setDraftId(result.draft.id)
          window.history.replaceState(null, '', `/studio/events/${result.draft.id}`)
        }
        setAutosave(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
      } catch {
        setAutosave('Offline — changes remain in this form')
      }
    }, 1100)
    return () => window.clearTimeout(timer)
  }, [version, draftId])

  const accessibility = event?.accessibility || {}
  const contact = event?.contact_links || {}
  const currentStatus = event?.status || 'draft'
  const canPreview = Boolean(draftId)

  return (
    <div className="editor-layout">
      <form ref={formRef} className="content-editor" action={saveEventDraft} onInput={() => setVersion((value) => value + 1)}>
        <input type="hidden" name="id" value={draftId} readOnly />
        <div className="editor-topbar">
          <div><span className={`status-dot status-${currentStatus}`} /> <strong>{currentStatus.replaceAll('_', ' ')}</strong><small>{autosave}</small></div>
          <div className="editor-actions">
            {canPreview ? <Link className="editor-button" href={`/studio/events/${draftId}/preview`}>Preview</Link> : <span className="editor-button is-disabled">Preview</span>}
            <button className="editor-button" type="submit">Save draft</button>
            <button className="editor-button editor-button-primary" type="submit" formAction={requestEventPublication}>Publish</button>
          </div>
        </div>

        <section className="editor-card editor-card-pink">
          <div className="editor-section-heading"><div><span className="section-pill">01 · Identity</span><h2>Who is hosting?</h2></div><p>You are always the user. A host profile only changes the public identity.</p></div>
          <label className="editor-field">Publish as<select name="host_profile_id" defaultValue={event?.host_profile_id || ''}>{identities.map((identity) => <option value={identity.id} key={`${identity.kind}-${identity.id || 'personal'}`}>{identity.name} · {identity.kind.replaceAll('_', ' ')}</option>)}</select></label>
        </section>

        <section className="editor-card">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-yellow">02 · Basics</span><h2>Make the card irresistible.</h2></div></div>
          <div className="editor-grid two">
            <label className="editor-field span-two">Event title<input name="title" required minLength="3" maxLength="120" defaultValue={event?.title || ''} placeholder="Neon Garden" /></label>
            <label className="editor-field">Category<select name="category" defaultValue={event?.category || 'live-music'}>{categories.filter((category) => category.content_kind !== 'location').map((category) => <option key={category.slug} value={category.slug}>{category.label}</option>)}</select></label>
            <label className="editor-field">Tags<input name="tags" defaultValue={listText(event?.tags)} placeholder="live music, rooftop, local" /></label>
            <label className="editor-field span-two">Short summary<textarea name="summary" maxLength="280" defaultValue={event?.summary || ''} placeholder="The one-line reason someone should swipe right." /></label>
            <label className="editor-field span-two">Full description<textarea className="editor-textarea-large" name="description" defaultValue={event?.description || ''} placeholder="What happens, who it is for, and what people should know." /></label>
          </div>
        </section>

        <section className="editor-card editor-card-mint">
          <div className="editor-section-heading"><div><span className="section-pill">03 · Schedule</span><h2>When does the plan happen?</h2></div></div>
          <div className="editor-grid two">
            <label className="editor-field">Starts<input name="starts_at" type="datetime-local" required defaultValue={formatDateTimeLocal(event?.starts_at)} /></label>
            <label className="editor-field">Ends<input name="ends_at" type="datetime-local" required defaultValue={formatDateTimeLocal(event?.ends_at)} /></label>
            <label className="editor-field">Timezone<select name="timezone" defaultValue={event?.timezone || 'America/Toronto'}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
            <label className="editor-field">Recurrence<select name="recurrence_rule" defaultValue={event?.recurrence_rule || ''}><option value="">One time</option><option value="FREQ=DAILY">Daily</option><option value="FREQ=WEEKLY">Weekly</option><option value="FREQ=MONTHLY">Monthly</option></select></label>
            <label className="editor-field">Repeat until<input name="recurrence_ends_at" type="datetime-local" defaultValue={formatDateTimeLocal(event?.recurrence_ends_at)} /></label>
            <label className="editor-field">Publish at<input name="publish_at" type="datetime-local" defaultValue={formatDateTimeLocal(event?.publish_at)} /></label>
          </div>
        </section>

        <section className="editor-card editor-card-purple">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-yellow">04 · Place</span><h2>Where should people go?</h2></div></div>
          <div className="editor-grid two">
            <label className="editor-field">Format<select name="event_format" defaultValue={event?.event_format || 'in_person'}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option><option value="private">Private location</option></select></label>
            <label className="editor-field">Puddle location<select name="location_id" defaultValue={event?.location_id || ''}><option value="">Use a custom address</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.city}</option>)}</select></label>
            <label className="editor-field">Public area or address<input name="address_public" defaultValue={event?.address_public || ''} placeholder="Kensington Market, Toronto" /></label>
            <label className="editor-field">Private exact address<input name="private_address" defaultValue={event?.private_address || ''} placeholder="Only revealed according to your rule" /></label>
            <label className="editor-field span-two">Online event link<input name="online_url" type="url" defaultValue={event?.online_url || ''} placeholder="https://…" /></label>
            <label className="editor-check span-two"><input name="exact_address_after_rsvp" type="checkbox" defaultChecked={event?.exact_address_after_rsvp} /> Reveal the exact address only after a confirmed RSVP or ticket</label>
          </div>
        </section>

        <section className="editor-card">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-mint">05 · Attendance</span><h2>Set the ground rules.</h2></div></div>
          <div className="editor-grid three">
            <label className="editor-field">Capacity<input name="capacity" type="number" min="1" max="100000" defaultValue={event?.capacity || ''} placeholder="Unlimited" /></label>
            <label className="editor-field">Minimum age<input name="min_age" type="number" min="0" max="99" defaultValue={event?.min_age ?? ''} placeholder="All ages" /></label>
            <label className="editor-field">Starting price, cents<input name="price_from_cents" type="number" min="0" defaultValue={event?.price_from_cents || 0} /></label>
            <label className="editor-field">Currency<select name="currency" defaultValue={event?.currency || 'CAD'}><option>CAD</option><option>USD</option><option>GBP</option><option>EUR</option></select></label>
            <label className="editor-field">Visibility<select name="visibility" defaultValue={event?.visibility || 'public'}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
            <div className="editor-check-stack"><label className="editor-check"><input name="approval_required" type="checkbox" defaultChecked={event?.approval_required} /> Approval required</label><label className="editor-check"><input name="comments_enabled" type="checkbox" defaultChecked={event?.comments_enabled ?? true} /> Comments enabled</label><label className="editor-check"><input name="chat_enabled" type="checkbox" defaultChecked={event?.chat_enabled ?? true} /> Event chat enabled</label></div>
            <label className="editor-field span-three">Attendee questions<textarea name="attendee_questions" defaultValue={listText(event?.attendee_questions)} placeholder="One question per line" /></label>
          </div>
        </section>

        <section className="editor-card editor-card-yellow">
          <div className="editor-section-heading"><div><span className="section-pill">06 · Access & contact</span><h2>Help everyone plan confidently.</h2></div></div>
          <div className="accessibility-grid">
            {['wheelchair_accessible','accessible_washroom','step_free','hearing_support','sensory_friendly'].map((key) => <label className="editor-check" key={key}><input name={key} type="checkbox" defaultChecked={accessibilityValue(accessibility, key)} /> {key.replaceAll('_', ' ')}</label>)}
          </div>
          <label className="editor-field">Accessibility notes<textarea name="accessibility_notes" defaultValue={accessibility.notes || ''} /></label>
          <div className="editor-grid two">
            <label className="editor-field">Website<input name="website" type="url" defaultValue={contactValue(contact, 'website')} /></label>
            <label className="editor-field">Instagram<input name="instagram" defaultValue={contactValue(contact, 'instagram')} /></label>
            <label className="editor-field">Contact email<input name="contact_email" type="email" defaultValue={contactValue(contact, 'email')} /></label>
            <label className="editor-field">Contact phone<input name="contact_phone" defaultValue={contactValue(contact, 'phone')} /></label>
          </div>
        </section>
      </form>

      <div className="editor-sidebar-stack">
        <RevisionHistory revisions={event?.revisions || []} label="Event history" />
        {draftId ? <section className="revision-card"><span className="section-pill section-pill-mint">Workflow</span><h2>Event controls</h2><p className="muted">Status changes are validated by database functions, not trusted browser input.</p><div className="workflow-buttons">
          {currentStatus === 'published' ? <><StatusForm id={draftId} status="postponed" label="Postpone" /><StatusForm id={draftId} status="cancelled" label="Cancel" /></> : null}
          {['draft','rejected','suspended'].includes(currentStatus) ? null : <StatusForm id={draftId} status="archived" label="Archive" />}
        </div></section> : null}
      </div>
    </div>
  )
}

function StatusForm({ id, status, label }) {
  return <form action={transitionEventStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="next_status" value={status} /><button className="editor-button" type="submit">{label}</button></form>
}
