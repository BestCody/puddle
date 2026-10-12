import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { AccountEmailForm } from '@/components/account-email-form'
import { requestPasswordReset } from '@/app/auth/actions'

export const metadata = { title: 'Reset password' }

export default function ForgotPasswordPage({ searchParams }) {
  return (
    <AuthShell eyebrow="No panic" title="Let’s get you back in." description="Enter your email and we’ll send a secure password-reset link.">
      <AuthMessage searchParams={searchParams} />
      <AccountEmailForm action={requestPasswordReset} label="Email" buttonLabel="Send reset link →" pendingText="Sending reset link…" />
      <div className={scopedClasses(authStyles, "auth-links")}><Link href="/">Back to sign in</Link></div>
    </AuthShell>
  )
}
