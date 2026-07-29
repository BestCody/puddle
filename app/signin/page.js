import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { signIn, signInWithOAuth, sendMagicLink } from '@/app/auth/actions'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const metadata = { title: 'Sign in' }

export default async function SignInPage({ searchParams }) {
  const params = await searchParams
  return (
    <AuthShell eyebrow="Welcome back" title="Jump back into your Puddle." description="Your saved plans, people, and tickets are waiting.">
      {!isSupabaseConfigured() && <div className="setup-note"><strong>Setup needed.</strong> Add the Supabase variables from <code>.env.example</code>.</div>}
      <AuthMessage searchParams={Promise.resolve(params)} />
      <form className="auth-form" action={signIn}>
        <input type="hidden" name="next" value={params?.next || '/dashboard'} />
        <label className="field">Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••" /></label>
        <SubmitButton>Sign in →</SubmitButton>
      </form>
      <div className="auth-divider">or</div>
      <div className="oauth-grid">
        <form action={signInWithOAuth}><input type="hidden" name="provider" value="google" /><SubmitButton className="oauth-button" pendingText="Opening Google…">Google</SubmitButton></form>
        <form action={signInWithOAuth}><input type="hidden" name="provider" value="apple" /><SubmitButton className="oauth-button" pendingText="Opening Apple…">Apple</SubmitButton></form>
      </div>
      <form className="auth-form" action={sendMagicLink} style={{marginTop:'1rem'}}>
        <input name="email" type="email" required placeholder="Email for a magic link" aria-label="Email for magic link" />
        <SubmitButton className="secondary-button" pendingText="Sending…">Email me a magic link</SubmitButton>
      </form>
      <div className="auth-links"><Link href="/signup">Create an account</Link><Link href="/forgot-password">Forgot password?</Link></div>
    </AuthShell>
  )
}
