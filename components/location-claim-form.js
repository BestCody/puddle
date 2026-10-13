'use client'

import { useActionState } from 'react'
import { SubmitButton } from './submit-button'
import { scopedClasses } from './scoped-classes'
import styles from './location-editor.module.css'

export function LocationClaimForm({ action, location, displayName, hosts }) {
  const [state, submit] = useActionState(action, null)
  return <form className={scopedClasses(styles, 'editor-card report-form')} action={submit} onReset={event => event.preventDefault()}>
    <input type="hidden" name="location_id" value={location.id} />
    <input type="hidden" name="next" value={`/places/${location.slug}`} />
    <label className={scopedClasses(styles, 'editor-field')}>Claim as<select name="host_profile_id"><option value="">{displayName} · personal</option>{hosts.map(host => <option key={host.id} value={host.id}>{host.name} · {host.kind.replaceAll('_', ' ')}</option>)}</select></label>
    <label className={scopedClasses(styles, 'editor-field')}>Your relationship<input name="relationship" required maxLength="120" placeholder="Owner, employee, venue manager, club organizer…" /></label>
    <label className={scopedClasses(styles, 'editor-field')}>Verification link<input name="evidence_url" type="url" placeholder="Official website, directory, or public profile" /></label>
    <label className={scopedClasses(styles, 'editor-field')}>Additional context<textarea name="note" maxLength="1200" /></label>
    {state?.error ? <p role="alert">{state.error}</p> : null}
    <SubmitButton pendingText="Submitting claim…">Submit claim →</SubmitButton>
  </form>
}
