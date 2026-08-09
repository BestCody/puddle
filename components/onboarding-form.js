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
  const errors = state?.fieldErrors || {}
  const selectedCount = selected.size

  useEffect(() => {
    if (!state?.submittedAt || !Object.keys(errors).length) return
    const firstInvalid = document.querySelector('[aria-invalid="true"]')
    firstInvalid?.focus?.()
  }, [state?.submittedAt, errors])

  function toggleLocation(value) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  return <form className="settings-card full auth-form onboarding-card" action={formAction}>
    {state?.message ? <div className="form-error-summary" role="alert">{state.message}</div> : null}

    <div className="field-row">
      <label className="field">Display name
        <input name="display_name" defaultValue={profile?.display_name || userDisplayName || ''} required maxLength={60} autoComplete="name" aria-invalid={Boolean(errors.display_name)} aria-describedby="display-name-error" />
        <small className="field-error" id="display-name-error">{errors.display_name}</small>
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
        <input aria-label="Search radius" name="search_radius_km" type="number" inputMode="numeric" min="1" max="100" step="1" defaultValue={profile?.search_radius_km || 10} required aria-invalid={Boolean(errors.search_radius_km)} aria-describedby="radius-hint radius-error" />
        <span className="radius-unit" aria-hidden="true">km</span>
      </span>
      <small className="field-hint" id="radius-hint">Choose a whole-number distance from 1 to 100 km.</small>
      <small className="field-error" id="radius-error">{errors.search_radius_km}</small>
    </label>

    <fieldset className="field interest-fieldset date-location-fieldset" aria-invalid={Boolean(errors.date_locations)}>
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
      <small className="field-error">{errors.date_locations}</small>
    </fieldset>

    <label className="field">Your ideal date vibe
      <textarea name="bio" maxLength={500} defaultValue={profile?.bio || ''} placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk." aria-invalid={Boolean(errors.bio)} aria-describedby="bio-hint bio-error" />
      <small className="field-hint" id="bio-hint">Optional · 500 characters maximum.</small>
      <small className="field-error" id="bio-error">{errors.bio}</small>
    </label>

    <label className="field">Profile visibility
      <select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'} aria-invalid={Boolean(errors.profile_visibility)} aria-describedby="visibility-error">
        <option value="public">Public</option>
        <option value="friends">Friends</option>
        <option value="mutuals">Mutuals</option>
        <option value="attendees">Confirmed attendees</option>
        <option value="hidden">Hidden</option>
      </select>
      <small className="field-error" id="visibility-error">{errors.profile_visibility}</small>
    </label>

    <div className="onboarding-submit">
      <SubmitButton className="primary-button onboarding-primary" pendingText="Building your date deck…" disabled={selectedCount < 3}>Build my date deck →</SubmitButton>
      {selectedCount < 3 ? <small className="field-hint">Select {3 - selectedCount} more {3 - selectedCount === 1 ? 'category' : 'categories'} to continue.</small> : null}
    </div>
  </form>
}
