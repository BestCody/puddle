"use client"

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { requestLocationPublication, saveLocationDraft, transitionLocationStatus } from '@/app/create/actions'
import { accessibilityValue, contactValue, listText } from './editor-shared'
import { GeocodeFields } from './geocode-fields'
import { RevisionHistory } from './revision-history'

const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const kinds = ['cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other']

export function LocationEditor({ location = null, identities = [] }) {
  const formRef = useRef(null)
  const [draftId, setDraftId] = useState(location?.id || '')
  const [autosave, setAutosave] = useState(location?.id ? 'Saved draft loaded' : 'Start typing to create a draft')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!version || !formRef.current) return
    const timer = window.setTimeout(async () => {
      const payload = Object.fromEntries(new FormData(formRef.current).entries())
      payload.id = draftId
      setAutosave('Saving…')
      try {
        const response = await fetch('/api/drafts/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const result = await response.json()
        if (!response.ok || !result.saved) {
          setAutosave(result.waiting ? 'Add the required basics to autosave' : result.error || 'Autosave paused')
          return
        }
        if (!draftId && result.draft?.id) {
          setDraftId(result.draft.id)
          window.history.replaceState(null, '', `/studio/places/${result.draft.id}`)
        }
        setAutosave(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
      } catch {
        setAutosave('Offline — changes remain in this form')
      }
    }, 1100)
    return () => window.clearTimeout(timer)
  }, [version, draftId])

  const accessibility = location?.accessibility || {}
  const contact = location?.contact_links || {}
  const hours = location?.opening_hours || {}
  const currentStatus = location?.status || 'draft'

  return (
    <div className="editor-layout">
      <form ref={formRef} className="content-editor" action={saveLocationDraft} onInput={() => setVersion((value) => value + 1)}>
        <input type="hidden" name="id" value={draftId} readOnly />
        <div className="editor-topbar">
          <div><span className={`status-dot status-${currentStatus}`} /> <strong>{currentStatus.replaceAll('_', ' ')}</strong><small>{autosave}</small></div>
          <div className="editor-actions">
            {draftId ? <Link className="editor-button" href={`/studio/places/${draftId}/preview`}>Preview</Link> : <span className="editor-button is-disabled">Preview</span>}
            <button className="editor-button" type="submit">Save draft</button>
            <button className="editor-button editor-button-primary" type="submit" formAction={requestLocationPublication}>Publish</button>
          </div>
        </div>

        <section className="editor-card editor-card-mint">
          <div className="editor-section-heading"><div><span className="section-pill">01 · Identity</span><h2>Who is adding this place?</h2></div><p>Suggest it personally or manage it through a host profile.</p></div>
          <label className="editor-field">Publish as<select name="host_profile_id" defaultValue={location?.host_profile_id || ''}>{identities.map((identity) => <option value={identity.id} key={`${identity.kind}-${identity.id || 'personal'}`}>{identity.name} · {identity.kind.replaceAll('_', ' ')}</option>)}</select></label>
        </section>

        <section className="editor-card">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-yellow">02 · Basics</span><h2>Give the place a personality.</h2></div></div>
          <div className="editor-grid two">
            <label className="editor-field span-two">Location name<input name="name" required minLength="2" maxLength="120" defaultValue={location?.name || ''} placeholder="Moonlight Café" /></label>
            <label className="editor-field">Type<select name="kind" defaultValue={location?.kind || 'cafe'}>{kinds.map((kind) => <option value={kind} key={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="editor-field">Category tags<input name="tags" defaultValue={listText(location?.tags)} placeholder="late-night, coffee, vinyl" /></label>
            <label className="editor-field span-two">Short summary<textarea name="summary" maxLength="500" defaultValue={location?.summary || ''} placeholder="Why should someone add this place to a plan?" /></label>
            <label className="editor-field span-two">Full description<textarea className="editor-textarea-large" name="description" defaultValue={location?.description || ''} /></label>
          </div>
        </section>

        <section className="editor-card editor-card-purple">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-yellow">03 · Map</span><h2>Put it in the right spot.</h2></div><p>Coordinates power radius search and the Explore map. Review the pin before publishing.</p></div>
          <div className="editor-grid two">
            <label className="editor-field">City<input name="city" required defaultValue={location?.city || ''} /></label>
            <label className="editor-field">Neighborhood<input name="neighborhood" defaultValue={location?.neighborhood || ''} /></label>
            <GeocodeFields defaultAddress={location?.address_public || ''} defaultLatitude={location?.latitude ?? ''} defaultLongitude={location?.longitude ?? ''} />
            <label className="editor-field span-two">Private exact address<input name="private_address" defaultValue={location?.private_address || ''} placeholder="Protected from public location records" /></label>
            <label className="editor-field">Timezone<input name="timezone" defaultValue={location?.timezone || 'America/Toronto'} /></label>
            <label className="editor-field">Visibility<select name="visibility" defaultValue={location?.visibility || 'public'}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
          </div>
        </section>

        <section className="editor-card editor-card-yellow">
          <div className="editor-section-heading"><div><span className="section-pill">04 · Hours & price</span><h2>When is it worth the trip?</h2></div></div>
          <div className="hours-grid">{days.map((day) => <label className="editor-field" key={day}>{day}<input name={`hours_${day}`} defaultValue={hours[day] || ''} placeholder="09:00-22:00 or Closed" /></label>)}</div>
          <label className="editor-field">Price range<select name="price_level" defaultValue={location?.price_level || ''}><option value="">Not specified</option><option value="1">$ · inexpensive</option><option value="2">$$ · moderate</option><option value="3">$$$ · higher</option><option value="4">$$$$ · premium</option></select></label>
        </section>

        <section className="editor-card">
          <div className="editor-section-heading"><div><span className="section-pill section-pill-mint">05 · Amenities</span><h2>What can people count on?</h2></div></div>
          <label className="editor-field">Amenities<textarea name="amenities" defaultValue={listText(location?.amenities)} placeholder="One per line: Wi-Fi, patio, outlets, parking" /></label>
          <div className="accessibility-grid">{['wheelchair_accessible','accessible_washroom','step_free','hearing_support','sensory_friendly'].map((key) => <label className="editor-check" key={key}><input name={key} type="checkbox" defaultChecked={accessibilityValue(accessibility, key)} /> {key.replaceAll('_', ' ')}</label>)}</div>
          <label className="editor-field">Accessibility notes<textarea name="accessibility_notes" defaultValue={accessibility.notes || ''} /></label>
          <label className="editor-check"><input name="comments_enabled" type="checkbox" defaultChecked={location?.comments_enabled ?? true} /> Allow public comments</label>
        </section>

        <section className="editor-card editor-card-pink">
          <div className="editor-section-heading"><div><span className="section-pill">06 · Contact</span><h2>Help people verify the details.</h2></div></div>
          <div className="editor-grid two">
            <label className="editor-field">Website<input name="website" type="url" defaultValue={contactValue(contact, 'website')} /></label>
            <label className="editor-field">Instagram<input name="instagram" defaultValue={contactValue(contact, 'instagram')} /></label>
            <label className="editor-field">Contact email<input name="contact_email" type="email" defaultValue={contactValue(contact, 'email')} /></label>
            <label className="editor-field">Contact phone<input name="contact_phone" defaultValue={contactValue(contact, 'phone')} /></label>
          </div>
        </section>
      </form>

      <div className="editor-sidebar-stack">
        <RevisionHistory revisions={location?.revisions || []} label="Location history" />
        {draftId ? <section className="revision-card"><span className="section-pill section-pill-mint">Workflow</span><h2>Location controls</h2><p className="muted">Community suggestions normally enter review before becoming public.</p><div className="workflow-buttons">{currentStatus === 'published' ? <StatusForm id={draftId} status="archived" label="Archive" /> : null}</div></section> : null}
      </div>
    </div>
  )
}

function StatusForm({ id, status, label }) {
  return <form action={transitionLocationStatus}><input type="hidden" name="id" value={id} /><input type="hidden" name="next_status" value={status} /><button className="editor-button" type="submit">{label}</button></form>
}
