'use client'

import { useActionState } from 'react'
import { SubmitButton } from './submit-button'
import { scopedClasses } from './scoped-classes'
import styles from './auth.module.css'

export function AccountEmailForm({ action, label, buttonLabel, pendingText, settingsReturn = null }) {
  const [state, submit] = useActionState(action, null)

  return <form className={scopedClasses(styles, 'auth-form')} action={submit} onReset={event => event.preventDefault()}>
    {settingsReturn ? <input type="hidden" name="settings_return" value={settingsReturn} /> : null}
    <label className="field">{label}<input name="email" type="email" autoComplete="email" required maxLength="254" placeholder="you@example.com" /></label>
    {state?.error ? <p role="alert">{state.error}</p> : null}
    {state?.success ? <p role="status">{state.success}</p> : null}
    <SubmitButton pendingText={pendingText}>{buttonLabel}</SubmitButton>
  </form>
}
