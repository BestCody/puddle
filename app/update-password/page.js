import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { updatePassword } from '@/app/auth/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Choose a new password' }

export default function UpdatePasswordPage({ searchParams }) {
  return (
    <AuthShell eyebrow="Fresh lock" title="Choose a new password." description="Use a unique password from ten to 128 characters.">
      <AuthMessage searchParams={searchParams} />
      <form className="auth-form" action={updatePassword}>
        <label className="field">New password<input name="password" type="password" autoComplete="new-password" minLength="10" maxLength="128" required /></label>
        <label className="field">Confirm password<input name="password_confirmation" type="password" autoComplete="new-password" minLength="10" maxLength="128" required /></label>
        <SubmitButton>Update password →</SubmitButton>
      </form>
    </AuthShell>
  )
}
