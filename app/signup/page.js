import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { signUp, signInWithOAuth } from '@/app/auth/actions'

export const metadata = { title: 'Create account' }

export default async function SignUpPage({ searchParams }) {
  const params = await searchParams
  const email = typeof params?.email === 'string' ? params.email.slice(0, 254) : ''

  return (
    <AuthShell eyebrow="New splash" title="Make plans that leave the chat." description="Create your profile, teach Puddle your vibe, and start finding things worth going out for.">
      <AuthMessage searchParams={params} />
      <form className="auth-form" action={signUp}>
        <label className="field">Display name<input name="display_name" autoComplete="name" required maxLength="60" placeholder="Ava" /></label>
        <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength="254" defaultValue={email} placeholder="you@example.com" /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="new-password" required minLength="10" maxLength="128" placeholder="10–128 characters" /></label>
        <label className="checkbox"><input type="checkbox" name="terms_accepted" value="yes" required /> <span>I agree to Puddle’s Terms and Privacy Policy and confirm the information I provide is accurate.</span></label>
        <SubmitButton>Create my Puddle →</SubmitButton>
      </form>
      <div className="auth-divider">or</div>
      <div className="oauth-grid" style={{ gridTemplateColumns: '1fr' }}>
        <form className="auth-form" action={signInWithOAuth}>
          <input type="hidden" name="provider" value="google" />
          <SubmitButton className="oauth-button" pendingText="Opening Google…">Continue with Google</SubmitButton>
        </form>
      </div>
      <div className="auth-links"><span>Already in?</span><Link href="/signin">Sign in</Link></div>
    </AuthShell>
  )
}
