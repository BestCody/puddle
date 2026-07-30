import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { resetPassword } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Choose a new password' }

export default async function ResetPasswordPage({ searchParams }) {
  let hasSession = false

  if (isSupabaseConfigured()) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    hasSession = Boolean(user)
  }

  return (
    <AuthShell
      eyebrow="Fresh lock"
      title="Choose a new password."
      description="Use a unique password with at least ten characters. After it is saved, Puddle will return you to sign in."
      asideTitle="Back in your puddle."
      asideText="Your account data stays exactly where you left it. Only the password changes."
    >
      <AuthMessage searchParams={searchParams} />

      {hasSession ? (
        <form className="auth-form" action={resetPassword}>
          <label className="field">
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength="10"
              required
            />
          </label>

          <label className="field">
            Confirm password
            <input
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              minLength="10"
              required
            />
          </label>

          <SubmitButton pendingText="Updating password…">
            Update password →
          </SubmitButton>
        </form>
      ) : (
        <>
          <p className="auth-message is-error">
            This password-reset session is missing or expired. Request a new reset email and open its link in this browser.
          </p>
          <Link className="primary-button" href="/forgot-password">
            Request a new reset link
          </Link>
        </>
      )}
    </AuthShell>
  )
}
