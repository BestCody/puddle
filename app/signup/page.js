import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { startGoogleSignup } from '@/app/auth/actions'
import { SignupForm } from './signup-form'

export const metadata = { title: 'Create account' }

export default async function SignUpPage({ searchParams }) {
  const params = await searchParams
  const email = typeof params?.email === 'string' ? params.email.slice(0, 254) : ''

  return (
    <AuthShell eyebrow="New splash" title="Make plans that leave the chat." description="Create your profile, teach Puddle your vibe, and start finding things worth going out for.">
      <AuthMessage searchParams={params} />
      <SignupForm initialEmail={email} />
      <div className={scopedClasses(authStyles, "auth-divider")}>or</div>
      <div className={scopedClasses(authStyles, "oauth-grid")} style={{ gridTemplateColumns: '1fr' }}>
        <form className={scopedClasses(authStyles, "auth-form")} action={startGoogleSignup}>
          <input type="hidden" name="provider" value="google" />
          <input type="hidden" name="signup_intent" value="1" />
          <label className={scopedClasses(authStyles, "checkbox")}><input type="checkbox" name="terms_accepted" value="yes" required /> <span>I agree to Puddle’s Terms and Privacy Policy before continuing with Google.</span></label>
          <SubmitButton className={scopedClasses(authStyles, "oauth-button")} pendingText="Opening Google…">Continue with Google</SubmitButton>
        </form>
      </div>
      <div className={scopedClasses(authStyles, "auth-links")}><span>Already in?</span><Link href="/">Sign in</Link></div>
    </AuthShell>
  )
}
