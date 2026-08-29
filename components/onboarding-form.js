"use client"

import { useActionState, useEffect, useRef, useState } from 'react'
import { BirthDateInput } from '@/components/birth-date-input'
import { LocationPicker } from '@/components/location-picker'
import { SubmitButton } from '@/components/submit-button'
import { UsernameInput } from '@/components/username-input'
import { birthDateError } from '@/lib/app/input-validation'

const INITIAL_STATE = { message: '', fieldErrors: {}, submittedAt: 0 }

// Figma: Puddle Official / Changes / Onboarding (nodes 230:208, 230:307, 232:501).
// Steps 4 and 5 are not drawn in Figma but the server action requires their
// fields, so they follow the same two-line heading and control language.
const STEPS = [
  { lead: 'Hi!', rest: 'Introduce yourself!' },
  { lead: 'Cool,', rest: 'Where are you from?' },
  { lead: 'How far would', rest: 'you travel?', blue: true },
  { lead: 'Nice.', rest: 'What do you like?' },
  { lead: 'Last thing.', rest: 'Set your vibe.' }
]

const FIELD_STEP = {
  display_name: 0,
  username: 0,
  birth_date: 0,
  location: 1,
  search_radius_km: 2,
  date_locations: 3,
  bio: 4,
  profile_visibility: 4,
  form: 4
}

function readValues(form) {
  if (!form) return null
  const data = new FormData(form)
  const text = (key) => String(data.get(key) || '').trim()
  return {
    displayName: text('display_name'),
    username: text('username'),
    birthDate: text('birth_date'),
    city: text('city'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    locationLabel: text('location_label'),
    radius: text('search_radius_km'),
    bio: String(data.get('bio') || ''),
    categories: data.getAll('date_locations').map(String)
  }
}

function stepBlocker(step, values) {
  if (!values) return ''
  if (step === 0) {
    if (!values.displayName || values.displayName.length > 60) return 'Add a display name from 1 to 60 characters.'
    if (!/^[a-z0-9_]{3,24}$/.test(values.username)) return 'Pick a username: 3–24 lowercase letters, numbers, or underscores.'
    const birthProblem = birthDateError(values.birthDate)
    if (values.birthDate.length !== 10 || birthProblem) return birthProblem || 'Enter your birth date as YYYY-MM-DD.'
    return ''
  }
  if (step === 1) {
    const latitude = Number(values.latitude)
    const longitude = Number(values.longitude)
    if (!values.city || values.latitude === '' || values.longitude === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return 'Choose a city or use your current location.'
    }
    return ''
  }
  if (step === 2) {
    const radius = Number(values.radius)
    if (!Number.isInteger(radius) || radius < 1 || radius > 100) return 'Choose a whole-number distance from 1 to 100 km.'
    return ''
  }
  if (step === 3) {
    if (values.categories.length < 3) return `Choose at least three. ${values.categories.length} of 3 selected.`
    return ''
  }
  if (values.bio.length > 500) return 'Keep your date vibe to 500 characters or fewer.'
  return ''
}

function ArrowRight() {
  return <svg viewBox="0 0 28 26" fill="none" aria-hidden="true" focusable="false">
    <path d="M2.5 13h22M16 4l8.5 9-8.5 9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function OnboardingForm({ action, profile = {}, userDisplayName = '', dateLocationOptions = [], signOutAction }) {
  const [state, formAction] = useActionState(action, INITIAL_STATE)
  const formRef = useRef(null)
  const [step, setStep] = useState(0)
  // Bumped by any interaction so the read-back effect below re-runs.
  const [, setTick] = useState(0)
  const [displayName, setDisplayName] = useState(profile?.display_name || userDisplayName || '')
  const [radius, setRadius] = useState(String(profile?.search_radius_km || 10))
  const [bio, setBio] = useState(profile?.bio || '')
  // Preserve the onboarding product default that existed before profile rows
  // started carrying the database-level `friends` default.
  const [visibility, setVisibility] = useState('public')
  const [selected, setSelected] = useState(() => new Set(profile?.interests || []))
  const [editedFields, setEditedFields] = useState(() => new Set())
  const errors = state?.fieldErrors || {}

  // Read every field back off the form element so values that live inside the
  // shared username, birth-date and location components stay in one place.
  // This runs after commit, so values the children reformat (birth date digits,
  // sanitised usernames, the picked location) are already in the DOM.
  const [values, setValues] = useState(null)
  const blocker = stepBlocker(step, values)
  const isLastStep = step === STEPS.length - 1

  useEffect(() => {
    const next = readValues(formRef.current)
    setValues((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  })

  useEffect(() => {
    if (!state?.submittedAt) return
    setEditedFields(new Set())
    const failed = Object.keys(state.fieldErrors || {})
    if (!failed.length) return
    setStep(Math.min(...failed.map((field) => FIELD_STEP[field] ?? 0)))
  }, [state?.submittedAt])

  function markEdited(field) {
    setEditedFields((current) => {
      if (current.has(field)) return current
      const next = new Set(current)
      next.add(field)
      return next
    })
  }

  function visibleError(field) {
    return editedFields.has(field) ? '' : errors[field] || ''
  }

  function toggleLocation(value) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
    markEdited('date_locations')
  }

  function goTo(next) {
    setStep(Math.min(Math.max(next, 0), STEPS.length - 1))
    formRef.current?.scrollTo?.({ top: 0 })
  }

  const heading = STEPS[step]
  const displayNameError = visibleError('display_name')
  const radiusError = visibleError('search_radius_km')
  const interestsError = visibleError('date_locations')
  const bioError = visibleError('bio')
  const visibilityError = visibleError('profile_visibility')
  const previewName = values?.displayName || displayName
  const previewCategories = values?.categories || []

  return <div className="pdl-onb-widget">
    <form
      className="pdl-onb-panel"
      ref={formRef}
      action={formAction}
      noValidate
      onInput={() => setTick((current) => current + 1)}
      onChange={() => setTick((current) => current + 1)}
    >
      <div className="pdl-onb-brand">
        <img src="/puddle-mark.svg" alt="" width="40" height="41" />
        <span>puddle</span>
      </div>

      <div
        className="pdl-onb-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-label={`Step ${step + 1} of ${STEPS.length}`}
      >
        <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="pdl-onb-crumbs">
        <button className="pdl-onb-crumb" type="button" hidden={step === 0} onClick={() => goTo(step - 1)}>Back</button>
        {step === 2 ? <button className="pdl-onb-crumb" type="button" onClick={() => { setRadius('10'); markEdited('search_radius_km'); goTo(step + 1) }}>Skip</button> : null}
        {step === 4 ? <button className="pdl-onb-crumb" type="button" onClick={() => { setBio(''); markEdited('bio') }}>Skip</button> : null}
      </div>

      <h1 className={`pdl-onb-heading${heading.blue ? ' is-blue' : ''}`}>
        <b>{heading.lead}</b>
        {heading.rest}
      </h1>

      {state?.message ? <p className="pdl-onb-alert" role="alert">{state.message}</p> : null}

      <div className="pdl-onb-body">
        <div className="pdl-onb-step" hidden={step !== 0}>
          <label className="pdl-onb-field">Display name
            <input
              name="display_name"
              type="text"
              value={displayName}
              onChange={(event) => { setDisplayName(event.target.value); markEdited('display_name') }}
              maxLength={60}
              autoComplete="name"
              placeholder="Type here..."
              aria-invalid={Boolean(displayNameError)}
              aria-describedby="display-name-error"
            />
            <small className="field-error" id="display-name-error">{displayNameError}</small>
          </label>

          <label className="pdl-onb-field">Username
            <UsernameInput defaultValue={profile?.username || ''} error={errors.username} id="onboarding-username" />
          </label>

          <label className="pdl-onb-field">Birth date
            <BirthDateInput defaultValue={profile?.birth_date || ''} serverError={errors.birth_date} />
          </label>
        </div>

        <div className="pdl-onb-step" hidden={step !== 1}>
          <LocationPicker profile={profile} error={errors.location} onLocationChange={() => setTick((current) => current + 1)} />
        </div>

        <div className="pdl-onb-step" hidden={step !== 2}>
          <label className="pdl-onb-field">Type a number:
            <span className="pdl-onb-radius">
              <input
                aria-label="Search radius"
                name="search_radius_km"
                type="number"
                inputMode="numeric"
                min="1"
                max="100"
                step="1"
                value={radius}
                onChange={(event) => { setRadius(event.target.value); markEdited('search_radius_km') }}
                placeholder="Type here..."
                aria-invalid={Boolean(radiusError)}
                aria-describedby="radius-hint radius-error"
              />
              <em aria-hidden="true">km</em>
            </span>
            <small className="pdl-onb-hint" id="radius-hint">Choose a whole-number distance from 1 to 100 km.</small>
            <small className="field-error" id="radius-error">{radiusError}</small>
          </label>
        </div>

        <div className="pdl-onb-step" hidden={step !== 3}>
          <fieldset className="pdl-onb-field pdl-onb-fieldset" aria-invalid={Boolean(interestsError)}>
            <legend>What kinds of places do you like for dates?</legend>
            <small className="pdl-onb-hint pdl-onb-hint-flush">Choose at least three.</small>
            <div className="pdl-onb-chips">
              {dateLocationOptions.map((option) => (
                <label className="pdl-onb-chip" key={option.value}>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  <input type="checkbox" name="date_locations" value={option.value} checked={selected.has(option.value)} onChange={() => toggleLocation(option.value)} aria-label={option.label} />
                </label>
              ))}
            </div>
            <small className="field-error">{interestsError}</small>
          </fieldset>
        </div>

        <div className="pdl-onb-step" hidden={step !== 4}>
          <label className="pdl-onb-field">Your ideal date vibe
            <textarea
              name="bio"
              maxLength={500}
              value={bio}
              onChange={(event) => { setBio(event.target.value); markEdited('bio') }}
              placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk."
              aria-invalid={Boolean(bioError)}
              aria-describedby="bio-hint bio-error"
            />
            <small className="pdl-onb-hint" id="bio-hint">Optional · {bio.length}/500 characters.</small>
            <small className="field-error" id="bio-error">{bioError}</small>
          </label>

          <label className="pdl-onb-field">Profile visibility
            <select
              name="profile_visibility"
              value={visibility}
              onChange={(event) => { setVisibility(event.target.value); markEdited('profile_visibility') }}
              aria-invalid={Boolean(visibilityError)}
              aria-describedby="visibility-error"
            >
              <option value="public">Public</option>
              <option value="friends">Friends</option>
              <option value="mutuals">Mutuals</option>
              <option value="attendees">Confirmed attendees</option>
              <option value="hidden">Hidden</option>
            </select>
            <small className="field-error" id="visibility-error">{visibilityError}</small>
          </label>
        </div>
      </div>

      <div className="pdl-onb-foot">
        <small className="pdl-onb-count" aria-live="polite">{blocker || `Step ${step + 1} of ${STEPS.length}`}</small>
        {isLastStep
          ? <SubmitButton className="pdl-onb-submit" pendingText="Building your deck…" disabled={!values || Boolean(blocker)}>Finish setup</SubmitButton>
          : <button className="pdl-onb-next" type="button" onClick={() => goTo(step + 1)} disabled={!values || Boolean(blocker)} aria-label="Next step"><ArrowRight /></button>}
      </div>
    </form>

    <aside className="pdl-onb-preview">
      {signOutAction ? <form className="pdl-onb-signout" action={signOutAction}><button type="submit">Sign out</button></form> : null}
      <p className="pdl-onb-preview-label">Your profile so far</p>

      <div className="pdl-onb-card">
        <div className="pdl-onb-card-top">
          <div className="pdl-onb-avatar" aria-hidden="true">{(previewName || '·').slice(0, 1)}</div>
          <div className="pdl-onb-card-name">
            <strong>{previewName || 'Your name'}</strong>
            {values?.username ? <span>@{values.username}</span> : <em>@username</em>}
          </div>
        </div>

        <dl className="pdl-onb-facts">
          <div className="pdl-onb-fact">
            <dt>From</dt>
            <dd className={values?.locationLabel || values?.city ? '' : 'is-empty'}>{values?.locationLabel || values?.city || 'Not set yet'}</dd>
          </div>
          <div className="pdl-onb-fact">
            <dt>Travels up to</dt>
            <dd className={values?.radius ? '' : 'is-empty'}>{values?.radius ? `${values.radius} km` : 'Not set yet'}</dd>
          </div>
          <div className="pdl-onb-fact">
            <dt>Visibility</dt>
            <dd className="is-capital">{visibility}</dd>
          </div>
        </dl>

        <div className="pdl-onb-tags">
          {previewCategories.length
            ? previewCategories.map((value) => <span key={value}>{dateLocationOptions.find((option) => option.value === value)?.label || value}</span>)
            : <span className="is-empty">Places you like show up here</span>}
        </div>

        <p className={`pdl-onb-bio${bio ? '' : ' is-empty'}`}>{bio || 'Your date vibe shows up here as you type it.'}</p>
      </div>

      <p className="pdl-onb-preview-note">This preview updates as you fill the form. Nothing is saved until you finish setup.</p>
    </aside>
  </div>
}
