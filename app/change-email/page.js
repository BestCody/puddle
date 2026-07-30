import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { requestEmailChange } from '@/app/auth/actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Change email address' }

export default async function ChangeEmailPage({ searchParams }) {
  const { user } = await requireUser()

  return (
    <AuthShell
      eyebrow="New inbox"
      title="Change your email address."
      description="Enter the new email you want to use for Puddle. Supabase may ask you to confirm the change from both your current and new inboxes."
      asideTitle="Same account. New inbox."
      asideText="Your profile, plans, friends, tickets, and activity stay attached to the same Puddle account."
    >
      <AuthMessage searchParams={searchParams} />

      <div className="setup-note">
        <strong>Current email</strong>
        <div>{user.email || 'Unavailable'}</div>
      </div>

      <form className="auth-form" action={requestEmailChange}>
        <label className="field">
          New email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="field">
          Confirm new email address
          <input
            name="email_confirmation"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>

        <SubmitButton pendingText="Sending confirmation…">
          Send confirmation emails →
        </SubmitButton>
      </form>

      <div className="auth-links">
        <Link href="/account">← Back to account settings</Link>
      </div>
    </AuthShell>
  )
}
