import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { requestPasswordReset } from '@/app/auth/actions'

export const metadata = { title: 'Reset password' }

export default function ForgotPasswordPage({ searchParams }) {
  return (
    <AuthShell eyebrow="No panic" title="Let’s get you back in." description="Enter your email and we’ll send a secure password-reset link.">
      <AuthMessage searchParams={searchParams} />
      <form className="auth-form" action={requestPasswordReset}>
        <label className="field">Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
        <SubmitButton>Send reset link →</SubmitButton>
      </form>
      <div className="auth-links"><Link href="/signin">Back to sign in</Link></div>
    </AuthShell>
  )
}
