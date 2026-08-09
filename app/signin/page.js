import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { signIn, signInWithOAuth, sendLoginCode, verifyLoginCode } from '@/app/auth/actions'

export const metadata = { title: 'Sign in' }

export default async function SignInPage({ searchParams }) {
  const params = await searchParams
  const next = typeof params?.next === 'string' ? params.next : '/dashboard'
  const email = typeof params?.email === 'string' ? params.email.slice(0, 254) : ''
  const codeSent = params?.code_sent === '1'

  return (
    <AuthShell eyebrow="Welcome back" title="Jump back into your Puddle." description="Your saved plans, people, and tickets are waiting.">
      <AuthMessage searchParams={params} />
      <form className="auth-form" action={signIn}>
        <input type="hidden" name="next" value={next} />
        <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength="254" defaultValue={email} placeholder="you@example.com" /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••" /></label>
        <SubmitButton>Sign in →</SubmitButton>
      </form>

      <div className="auth-divider">or</div>
      <div className="oauth-grid" style={{ gridTemplateColumns: '1fr' }}>
        <form className="auth-form" action={signInWithOAuth}>
          <input type="hidden" name="provider" value="google" />
          <SubmitButton className="oauth-button" pendingText="Opening Google…">Continue with Google</SubmitButton>
        </form>
      </div>

      <div className="auth-divider">or use a one-time code</div>
      {codeSent ? (
        <>
          <form className="auth-form" action={verifyLoginCode}>
            <input type="hidden" name="next" value={next} />
            <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength="254" defaultValue={email} /></label>
            <label className="field">One-time login code<input name="token" inputMode="numeric" autoComplete="one-time-code" required minLength="6" maxLength="8" pattern="[0-9]{6,8}" placeholder="123456" /></label>
            <SubmitButton pendingText="Checking code…">Sign in with code →</SubmitButton>
          </form>
          <form className="auth-form" action={sendLoginCode} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="email" value={email} />
            <SubmitButton className="secondary-button" pendingText="Sending another code…">Send a new code</SubmitButton>
          </form>
        </>
      ) : (
        <form className="auth-form" action={sendLoginCode}>
          <input type="hidden" name="next" value={next} />
          <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength="254" defaultValue={email} placeholder="you@example.com" /></label>
          <SubmitButton className="secondary-button" pendingText="Sending code…">Email me a one-time login code</SubmitButton>
        </form>
      )}

      <div className="auth-links"><Link href="/signup">Create an account</Link><Link href="/forgot-password">Forgot password?</Link></div>
    </AuthShell>
  )
}
