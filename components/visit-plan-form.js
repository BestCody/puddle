'use client'

import { useActionState } from 'react'
import { VisitDateTime } from './visit-date-time'
import { SubmitButton } from './submit-button'
import { scopedClasses } from './scoped-classes'
import styles from './shared-ui.module.css'

export function VisitPlanForm({ action, locationId, existing }) {
  const [state, submit] = useActionState(action, null)
  return <form className={scopedClasses(styles, 'visit-plan-form')} action={submit} onReset={event => event.preventDefault()}>
    <input type="hidden" name="location_id" value={locationId} />
    <label>Status<select name="status" defaultValue={existing?.status || 'planned'}><option value="planned">Plan a visit</option><option value="visited">I already visited</option></select></label>
    <label>Planned time<VisitDateTime initialValue={existing?.planned_for} /></label>
    <label className="span-two">Note<textarea name="note" maxLength={500} defaultValue={existing?.note || ''} placeholder="Try the patio, meet by the entrance, bring a sketchbook…" /><small className="field-hint">500 characters maximum.</small></label>
    {state?.error ? <p className="span-two" role="alert">{state.error}</p> : null}
    <SubmitButton className={scopedClasses(styles, 'splash-button splash-button-mint')} pendingText="Saving visit…">Save visit</SubmitButton>
  </form>
}
