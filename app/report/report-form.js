'use client'

import { useActionState, useState } from 'react'
import editorStyles from '@/components/location-editor.module.css'
import { scopedClasses } from '@/components/scoped-classes'
import { SubmitButton } from '@/components/submit-button'
import { TurnstileWidget } from '@/components/turnstile-widget'
import { submitContentReport } from '@/app/report/actions'

export function ReportForm({ context }) {
  const [category, setCategory] = useState('')
  const [details, setDetails] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [state, action] = useActionState(async (previous, data) => {
    const result = await submitContentReport(previous, data)
    setAttempt(value => value + 1)
    return result
  }, null)
  return <form className={scopedClasses(editorStyles, "editor-card report-form")} action={action} onReset={event => event.preventDefault()}>
      <input type="hidden" name="target_type" value={context.target_type || ''} />
      <input type="hidden" name="target_id" value={context.target_id || ''} />
      <input type="hidden" name="return_to" value={context.return_to || '/discover'} />
      <label className={scopedClasses(editorStyles, "editor-field")}>Reason<select name="category" required value={category} onChange={event => setCategory(event.target.value)}>
        <option value="" disabled>Choose a reason</option>
        <option value="incorrect_information">Incorrect information</option>
        <option value="unsafe_or_illegal">Unsafe or illegal activity</option>
        <option value="fraud_or_impersonation">Fraud or impersonation</option>
        <option value="harassment">Harassment or unwanted contact</option>
        <option value="spam">Spam</option>
        <option value="privacy">Privacy concern</option>
        <option value="duplicate">Duplicate listing</option>
        <option value="other">Other</option>
      </select></label>
      <label className={scopedClasses(editorStyles, "editor-field")}>Details<textarea className={scopedClasses(editorStyles, "editor-textarea-large")} name="details" value={details} onChange={event => setDetails(event.target.value)} maxLength="3000" required placeholder="Describe what happened and include the context a moderator will need." /></label>
      <TurnstileWidget key={attempt} action="submit_report" />
      {state?.error ? <p role="alert">{state.error}</p> : null}
      <SubmitButton>Submit report →</SubmitButton>
    </form>
}
