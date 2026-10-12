import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { AccountEmailForm } from '@/components/account-email-form'
import { updateEmail } from '@/app/auth/actions'
import { settingsActionDestination } from '@/lib/app/settings-navigation'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Change email address' }

export default async function ChangeEmailPage({ searchParams }) {
  const { user } = await requireUser()
  const params = await searchParams
  const destination = settingsActionDestination({ get: () => params?.settings_return }, 'security')

  return (
    <AuthShell
      eyebrow="New inbox"
      title="Change your email address."
      description="Enter the new email you want to use for Puddle. Supabase may require confirmation from both your current and new inboxes."
      asideTitle="Same account. New inbox."
      asideText="Your profile, plans, friends, tickets, and activity stay attached to the same Puddle account."
    >
      <AuthMessage searchParams={searchParams} />

      <div className={scopedClasses(authStyles, "setup-note")}>
        <strong>Current email</strong>
        <div>{user.email || 'Unavailable'}</div>
      </div>

      <AccountEmailForm action={updateEmail} label="New email address" buttonLabel="Send confirmation emails →" pendingText="Sending confirmation…" settingsReturn={destination} />

      <div className={scopedClasses(authStyles, "auth-links")}>
        <Link href={destination}>← Back to account settings</Link>
      </div>
    </AuthShell>
  )
}
