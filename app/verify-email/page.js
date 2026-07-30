import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'

export const metadata = { title: 'Verify email' }

export default async function VerifyEmailPage({ searchParams }) {
  const params = await searchParams

  return (
    <AuthShell
      eyebrow="One tiny step"
      title="Check your inbox."
      description={`We sent a confirmation link${params?.email ? ` to ${params.email}` : ''}. Open it to confirm your account. Puddle will then bring you to sign in.`}
      asideTitle="Your deck is almost ready."
      asideText="Email verification keeps fake accounts out and makes account recovery possible."
    >
      <div className="setup-note">
        <strong>Didn’t see it?</strong> Check spam, wait a minute, or return to signup and try again.
      </div>
      <div className="auth-links">
        <Link href="/signin">Back to sign in</Link>
        <Link href="/signup">Use another email</Link>
      </div>
    </AuthShell>
  )
}
