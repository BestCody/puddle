import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'

export const metadata = { title: 'Authentication problem' }

export default function AuthErrorPage() {
  return (
    <AuthShell eyebrow="Tiny wipeout" title="That link did not work." description="The authentication link may have expired or already been used.">
      <div className={scopedClasses(authStyles, "auth-links")}><Link href="/">Try signing in</Link><Link href="/forgot-password">Request a new link</Link></div>
    </AuthShell>
  )
}
