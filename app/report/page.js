import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { TurnstileWidget } from '@/components/turnstile-widget'
import { renderProductPage } from '@/lib/app/render-product-page'
import { submitContentReport } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Report', robots: { index: false, follow: false } }

export default async function ReportPage({ searchParams }) {
  const params = await searchParams
  const target = String(params?.target_type || '').replaceAll('_',' ')
  return renderProductPage(async () => <><div className="page-heading-row"><div><span className="section-pill section-pill-yellow">Safety & accuracy</span><h1 className="product-title">Report {target || 'something'}.</h1><p>Reports can cover listings, profiles, conversations, messages, comments, and shared plans. Message and comment evidence is preserved for moderators.</p></div></div><AuthMessage searchParams={params}/><form className="editor-card report-form" action={submitContentReport}><input type="hidden" name="target_type" value={params?.target_type || ''}/><input type="hidden" name="target_id" value={params?.target_id || ''}/><input type="hidden" name="return_to" value={params?.return_to || '/discover'}/><label className="editor-field">Reason<select name="category" required defaultValue=""><option value="" disabled>Choose a reason</option><option value="incorrect_information">Incorrect information</option><option value="unsafe_or_illegal">Unsafe or illegal activity</option><option value="fraud_or_impersonation">Fraud or impersonation</option><option value="harassment">Harassment or unwanted contact</option><option value="spam">Spam</option><option value="privacy">Privacy concern</option><option value="duplicate">Duplicate listing</option><option value="other">Other</option></select></label><label className="editor-field">Details<textarea className="editor-textarea-large" name="details" maxLength="3000" required placeholder="Describe what happened and include the context a moderator will need."/></label><TurnstileWidget action="submit_report"/><SubmitButton>Submit report →</SubmitButton></form></>)
}
