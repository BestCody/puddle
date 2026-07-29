import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { signUp, signInWithOAuth } from '@/app/auth/actions'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const metadata = { title: 'Create account' }

export default async function SignUpPage({ searchParams }) {
  const params = await searchParams
  const email = typeof params?.email === 'string' ? params.email.slice(0, 254) : ''

  return (
    <AuthShell eyebrow="New splash" title="Make plans that leave the chat." description="Create your profile, teach Puddle your vibe, and start finding things worth going out for.">
      {!isSupabaseConfigured() && <div className="setup-note"><strong>Setup needed.</strong> Add the Supabase variables from <code>.env.example</code>.</div>}
      <AuthMessage searchParams={params} />
      <form className="auth-form" action={signUp}>
        <label className="field">Display name<input name="display_name" autoComplete="name" required maxLength="60" placeholder="Ava" /></label>
        <label className="field">Email<input name="email" type="email" autoComplete="email" required defaultValue={email} placeholder="you@example.com" /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="new-password" required minLength="10" placeholder="At least 10 characters" /></label>
        <label className="checkbox"><input type="checkbox" required /> <span>I agree to Puddle’s Terms and Privacy Policy and confirm the information I provide is accurate.</span></label>
        <SubmitButton>Create my Puddle →</SubmitButton>
      </form>
      <div className="auth-divider">or</div>
      <div className="oauth-grid">
        <form action={signInWithOAuth}><input type="hidden" name="provider" value="google" /><SubmitButton className="oauth-button">Google</SubmitButton></form>
        <form action={signInWithOAuth}><input type="hidden" name="provider" value="apple" /><SubmitButton className="oauth-button">Apple</SubmitButton></form>
      </div>
      <div className="auth-links"><span>Already in?</span><Link href="/signin">Sign in</Link></div>
    </AuthShell>
  )
}
