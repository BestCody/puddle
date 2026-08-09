"use client"

import { useActionState, useEffect, useMemo, useState } from 'react'
import { BirthDateInput } from '@/components/birth-date-input'
import { LocationPicker } from '@/components/location-picker'
import { SubmitButton } from '@/components/submit-button'
import { UsernameInput } from '@/components/username-input'

const INITIAL_STATE = { message: '', fieldErrors: {}, submittedAt: 0 }

export function OnboardingForm({ action, profile = {}, userDisplayName = '', dateLocationOptions = [] }) {
  const [state, formAction] = useActionState(action, INITIAL_STATE)
  const initialSelected = useMemo(() => new Set(profile?.interests || []), [profile?.interests])
  const [selected, setSelected] = useState(initialSelected)
  const [displayName, setDisplayName] = useState(profile?.display_name || userDisplayName || '')
  const [radius, setRadius] = useState(String(profile?.search_radius_km || 10))
  const [bio, setBio] = useState(profile?.bio || '')
  // Preserve the onboarding product default that existed before profile rows
  // started carrying the database-level `friends` default.
  const [visibility, setVisibility] = useState('public')
  const [editedFields, setEditedFields] = useState(() => new Set())
  const errors = state?.fieldErrors || {}
  const selectedCount = selected.size

  useEffect(() => {
    if (!state?.submittedAt) return
    setEditedFields(new Set())
    if (!Object.keys(errors).length) return
    const firstInvalid = document.querySelector('[aria-invalid="true"]')
    firstInvalid?.focus?.()
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

  const displayNameError = visibleError('display_name')
  const radiusError = visibleError('search_radius_km')
  const interestsError = visibleError('date_locations')
  const bioError = visibleError('bio')
  const visibilityError = visibleError('profile_visibility')

  return <form className="settings-card full auth-form onboarding-card" action={formAction}>
    {state?.message ? <div className="form-error-summary" role="alert">{state.message}</div> : null}

    <div className="field-row">
      <label className="field">Display name
        <input
          name="display_name"
          value={displayName}
          onChange={(event) => { setDisplayName(event.target.value); markEdited('display_name') }}
          required
          maxLength={60}
          autoComplete="name"
          aria-invalid={Boolean(displayNameError)}
          aria-describedby="display-name-error"
        />
        <small className="field-error" id="display-name-error">{displayNameError}</small>
      </label>
      <label className="field">Username
        <UsernameInput defaultValue={profile?.username || ''} error={errors.username} id="onboarding-username" />
      </label>
    </div>

    <label className="field">Birth date
      <BirthDateInput defaultValue={profile?.birth_date || ''} serverError={errors.birth_date} />
    </label>

    <LocationPicker profile={profile} error={errors.location} />

    <label className="field">How far would you travel?
      <span className="radius-control">
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
          required
          aria-invalid={Boolean(radiusError)}
          aria-describedby="radius-hint radius-error"
        />
        <span className="radius-unit" aria-hidden="true">km</span>
      </span>
      <small className="field-hint" id="radius-hint">Choose a whole-number distance from 1 to 100 km.</small>
      <small className="field-error" id="radius-error">{radiusError}</small>
    </label>

    <fieldset className="field interest-fieldset date-location-fieldset" aria-invalid={Boolean(interestsError)}>
      <legend>What kinds of places do you like for dates?</legend>
      <p className="date-location-help">Choose at least three. <strong>{selectedCount} of 3 minimum selected.</strong></p>
      <div className="interest-grid date-location-grid">
        {dateLocationOptions.map((option) => (
          <label className="interest-chip date-location-chip" key={option.value}>
            <span><strong>{option.label}</strong><small>{option.detail}</small></span>
            <input type="checkbox" name="date_locations" value={option.value} checked={selected.has(option.value)} onChange={() => toggleLocation(option.value)} aria-label={option.label} />
          </label>
        ))}
      </div>
      <small className="field-error">{interestsError}</small>
    </fieldset>

    <label className="field">Your ideal date vibe
      <textarea
        name="bio"
        maxLength={500}
        value={bio}
        onChange={(event) => { setBio(event.target.value); markEdited('bio') }}
        placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk."
        aria-invalid={Boolean(bioError)}
        aria-describedby="bio-hint bio-error"
      />
      <small className="field-hint" id="bio-hint">Optional · {bio.length}/500 characters.</small>
      <small className="field-error" id="bio-error">{bioError}</small>
    </label>

    <label className="field">Profile visibility
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

    <div className="onboarding-submit">
      <SubmitButton className="primary-button onboarding-primary" pendingText="Building your date deck…" disabled={selectedCount < 3}>Build my date deck →</SubmitButton>
      {selectedCount < 3 ? <small className="field-hint">Select {3 - selectedCount} more {3 - selectedCount === 1 ? 'category' : 'categories'} to continue.</small> : null}
    </div>
  </form>
}
