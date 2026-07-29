import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'

export const metadata = { title: 'Authentication problem' }

export default async function AuthErrorPage({ searchParams }) {
  const params = await searchParams
  return (
    <AuthShell eyebrow="Tiny wipeout" title="That link did not work." description={params?.error || 'The authentication link may have expired or already been used.'}>
      <div className="auth-links"><Link href="/signin">Try signing in</Link><Link href="/forgot-password">Request a new link</Link></div>
    </AuthShell>
  )
}
