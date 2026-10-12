"use client"

import { useActionState } from 'react'
import { signUp } from '@/app/auth/actions'
import { SubmitButton } from '@/components/submit-button'
import { scopedClasses } from '@/components/scoped-classes'
import styles from '@/components/auth.module.css'

export function SignupForm({ initialEmail = '' }) {
  const [state, submit] = useActionState(signUp, null)

  return <form className={scopedClasses(styles, 'auth-form')} action={submit} onReset={event => event.preventDefault()}>
    <label className="field">Display name<input name="display_name" autoComplete="name" required maxLength="60" placeholder="Ava" /></label>
    <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength="254" defaultValue={initialEmail} placeholder="you@example.com" /></label>
    <label className="field">Password<input name="password" type="password" autoComplete="new-password" required minLength="10" maxLength="128" placeholder="10–128 characters" /></label>
    <label className={scopedClasses(styles, 'checkbox')}><input type="checkbox" name="terms_accepted" value="yes" required /> <span>I agree to Puddle’s Terms and Privacy Policy and confirm the information I provide is accurate.</span></label>
    {state?.error ? <p role="alert">{state.error}</p> : null}
    <SubmitButton>Create my Puddle →</SubmitButton>
  </form>
}
