"use client"

import { useMemo, useRef, useState } from 'react'

const PURPOSES = [
  ['title', 'Title'],
  ['short_description', 'Short description'],
  ['description', 'Full description'],
  ['categories_tags', 'Categories and tags'],
  ['accessibility_prompts', 'Accessibility prompts'],
  ['social_caption', 'Social caption'],
  ['missing_information', 'Missing information']
]

function value(form, name) {
  const field = form.elements.namedItem(name)
  if (!field) return ''
  if (field instanceof RadioNodeList) return field.value
  if (field.type === 'checkbox') return field.checked
  return field.value
}

function list(value) {
  return String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 40)
}

function collectSource(form, contentKind) {
  const accessibility = {}
  for (const key of ['wheelchair_accessible','accessible_washroom','step_free','hearing_support','sensory_friendly']) accessibility[key] = Boolean(value(form, key))
  if (contentKind === 'event') {
    return {
      title: value(form, 'title'), category: value(form, 'category'), tags: list(value(form, 'tags')), summary: value(form, 'summary'), description: value(form, 'description'),
      starts_at: value(form, 'starts_at'), ends_at: value(form, 'ends_at'), timezone: value(form, 'timezone'), event_format: value(form, 'event_format'),
      address_public: value(form, 'address_public'), online_url: value(form, 'online_url'), capacity: value(form, 'capacity'), min_age: value(form, 'min_age'),
      price_from_cents: value(form, 'price_from_cents'), currency: value(form, 'currency'), accessibility, accessibility_notes: value(form, 'accessibility_notes'),
      website: value(form, 'website'), instagram: value(form, 'instagram'), contact_email: value(form, 'contact_email'), contact_phone: value(form, 'contact_phone')
    }
  }
  const openingHours = {}
  for (const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) openingHours[day] = value(form, `hours_${day}`)
  return {
    name: value(form, 'name'), kind: value(form, 'kind'), tags: list(value(form, 'tags')), summary: value(form, 'summary'), description: value(form, 'description'),
    city: value(form, 'city'), neighborhood: value(form, 'neighborhood'), address_public: value(form, 'address_public'), timezone: value(form, 'timezone'),
    opening_hours: openingHours, price_level: value(form, 'price_level'), amenities: list(value(form, 'amenities')), accessibility,
    accessibility_notes: value(form, 'accessibility_notes'), website: value(form, 'website'), instagram: value(form, 'instagram'),
    contact_email: value(form, 'contact_email'), contact_phone: value(form, 'contact_phone')
  }
}

function setField(form, name, nextValue) {
  const field = form.elements.namedItem(name)
  if (!field || field instanceof RadioNodeList) return
  field.value = Array.isArray(nextValue) ? nextValue.join(', ') : String(nextValue ?? '')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

function suggestionFields(contentKind, suggestions) {
  const titleKey = contentKind === 'event' ? 'title' : 'name'
  return [titleKey, 'summary', 'description', contentKind === 'event' ? 'category' : 'kind', 'tags', 'socialCaption'].filter((key) => suggestions?.[key] !== undefined)
}

export function AiCreationAssistant({ contentKind, contentId = '' }) {
  const rootRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [runId, setRunId] = useState('')
  const [result, setResult] = useState(null)
  const [edited, setEdited] = useState({})
  const [beforeApply, setBeforeApply] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const fields = useMemo(() => suggestionFields(contentKind, edited), [contentKind, edited])

  function form() {
    return rootRef.current?.closest('form') || document.querySelector('form.content-editor')
  }

  async function requestAssistance(purpose) {
    const targetForm = form()
    if (!targetForm) return
    setBusy(true)
    setMessage('Reviewing only the facts currently in this draft…')
    setResult(null)
    setAccepted(false)
    try {
      const response = await fetch('/api/ai/assist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentKind, contentId: contentId || value(targetForm, 'id'), purpose, sourceFields: collectSource(targetForm, contentKind) })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Creation assistance failed.')
      setRunId(payload.runId)
      setResult(payload.output)
      setEdited(payload.output?.suggestions || {})
      setMessage(payload.provider === 'rules' ? 'Rules-based prompts are ready. A local writing model is not configured.' : 'Suggestion ready for human review. Nothing has been applied.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision, humanEdits = null, attachContentId = null) {
    const response = await fetch('/api/ai/decision', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, decision, editedOutput: humanEdits, contentId: attachContentId })
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'The review decision could not be saved.')
    return payload
  }

  async function applySuggestion() {
    const targetForm = form()
    if (!targetForm || !runId) return
    setBusy(true)
    try {
      const currentDraftId = value(targetForm, 'id')
      if (!currentDraftId) throw new Error('Save or autosave this draft before applying assisted wording.')
      await decide('accept', edited, currentDraftId)
      const previous = {}
      for (const key of fields) {
        const formName = key === 'socialCaption' ? null : key
        if (!formName) continue
        previous[formName] = value(targetForm, formName)
        setField(targetForm, formName, edited[key])
      }
      setBeforeApply(previous)
      setAccepted(true)
      setMessage('Human-reviewed wording applied. Save the draft to keep it.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function rejectSuggestion() {
    if (!runId) return
    setBusy(true)
    try {
      await decide('reject')
      setResult(null)
      setEdited({})
      setMessage('Suggestion rejected. Your draft was not changed.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function rollback() {
    const targetForm = form()
    if (!targetForm || !beforeApply || !runId) return
    setBusy(true)
    try {
      await decide('rollback')
      for (const [key, prior] of Object.entries(beforeApply)) setField(targetForm, key, prior)
      setAccepted(false)
      setMessage('AI wording rolled back to the values from before it was applied.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return <section ref={rootRef} className="ai-creation-card" aria-label="Local AI creation assistant">
    <div className="ai-creation-heading"><div><span className="section-pill section-pill-mint">Local creation assistant</span><h2>Improve wording without inventing facts.</h2><p>Puddle sends only the visible draft facts to your self-hosted model. Every suggestion requires review and acceptance.</p></div><strong>No external AI key</strong></div>
    <div className="ai-purpose-grid">{PURPOSES.map(([purpose, label]) => <button type="button" disabled={busy} onClick={() => requestAssistance(purpose)} key={purpose}>{label}</button>)}</div>
    {message ? <p className="ai-assistant-message" role="status">{message}</p> : null}
    {result ? <div className="ai-review-panel">
      <div className="ai-review-heading"><h3>Review the proposed wording</h3><span>Not applied</span></div>
      {fields.map((key) => <label className="editor-field" key={key}>{key.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ')}
        {['description','summary','socialCaption'].includes(key) ? <textarea value={Array.isArray(edited[key]) ? edited[key].join(', ') : edited[key] || ''} onChange={(event) => setEdited((current) => ({ ...current, [key]: event.target.value }))} /> : <input value={Array.isArray(edited[key]) ? edited[key].join(', ') : edited[key] || ''} onChange={(event) => setEdited((current) => ({ ...current, [key]: key === 'tags' ? list(event.target.value) : event.target.value }))} />}
      </label>)}
      {result.missingFields?.length ? <div className="ai-review-list"><h4>Missing information</h4>{result.missingFields.map((item) => <p key={`${item.field}-${item.reason}`}><strong>{item.field.replaceAll('_', ' ')}</strong>{item.reason ? ` · ${item.reason}` : ''}</p>)}</div> : null}
      {result.categorySuggestions?.length ? <div className="ai-review-list"><h4>Supported categories</h4>{result.categorySuggestions.map((item) => <p key={item.value}><strong>{item.value.replaceAll('_', ' ')}</strong> · {item.reason}</p>)}</div> : null}
      {result.accessibilityQuestions?.length ? <div className="ai-review-list"><h4>Questions to verify</h4>{result.accessibilityQuestions.map((question) => <p key={question}>{question}</p>)}</div> : null}
      {result.warnings?.length ? <div className="ai-grounding-warning">{result.warnings.join(' ')}</div> : null}
      <div className="ai-review-actions"><button type="button" disabled={busy || accepted || fields.length === 0} onClick={applySuggestion}>Accept and apply reviewed wording</button><button type="button" className="quiet-button" disabled={busy || accepted} onClick={rejectSuggestion}>Reject</button>{accepted ? <button type="button" className="danger-link" disabled={busy} onClick={rollback}>Roll back applied wording</button> : null}</div>
    </div> : null}
  </section>
}
