import Link from 'next/link'
import { ProductShell } from '@/components/product-shell'
import { AuthMessage } from '@/components/auth-message'
import { LocationPicker } from '@/components/location-picker'
import { SubmitButton } from '@/components/submit-button'
import { UsernameInput } from '@/components/username-input'
import { deleteAccount, revokeOtherSessions, updatePassword } from '@/app/auth/actions'
import { updateDateProfile } from './actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account settings' }

export default async function AccountPage({ searchParams }) {
  const { user, profile } = await requireUser({ onboarding: true })
  const sessionExpiry = user.aud ? 'Managed securely by Supabase Auth' : 'Active'

  return (
    <ProductShell user={user} profile={profile}>
      <span className="section-pill section-pill-yellow">Your corner</span>
      <h1 className="product-title">Account settings.</h1>
      <AuthMessage searchParams={searchParams} />

      <div className="settings-grid">
        <form className="settings-card full" action={updateDateProfile}>
          <h2>Profile and date preferences</h2>
          <p className="muted">Manage your profile details, location, date vibe, and visibility.</p>
          <div className="field-row">
            <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></label>
            <label className="field">Username<UsernameInput defaultValue={profile?.username || ''} id="account-username" /></label>
          </div>
          <LocationPicker profile={profile} />
          <label className="field">Your ideal date vibe<textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk." /><small className="field-hint">500 characters maximum.</small></label>
          <label className="field">Profile visibility<select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></label>
          <SubmitButton pendingText="Saving preferences…">Save profile and date preferences</SubmitButton>
        </form>

        <section className="settings-card">
          <h2>Email and password</h2>
          <div className="session-box">
            <strong>{user.email || 'No email available'}</strong>
            <p className="muted">Your sign-in email and security notifications use this address.</p>
          </div>
          <Link className="secondary-button" href="/change-email">Change email address</Link>

          <form className="auth-form" action={updatePassword}>
            <label className="field">New password<input name="password" type="password" minLength="10" maxLength="128" required /></label>
            <label className="field">Confirm password<input name="password_confirmation" type="password" minLength="10" maxLength="128" required /></label>
            <SubmitButton>Change password</SubmitButton>
          </form>
        </section>

        <section className="settings-card">
          <h2>Sessions</h2>
          <div className="session-box">
            <strong>Current browser</strong>
            <p className="muted">{sessionExpiry}. Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}.</p>
          </div>
          <form action={revokeOtherSessions}>
            <SubmitButton className="secondary-button">Sign out every other session</SubmitButton>
          </form>
        </section>

        <section className="settings-card full danger-zone">
          <h2>Delete account</h2>
          <p className="muted">This permanently removes your account and associated Puddle records. Type <span className="code-hint">DELETE</span> to continue.</p>
          <form className="auth-form" action={deleteAccount}>
            <label className="field">Confirmation<input name="confirmation" autoComplete="off" required minLength="6" maxLength="6" pattern="DELETE" /></label>
            <SubmitButton className="danger-button" pendingText="Deleting…">Delete my account</SubmitButton>
          </form>
        </section>
      </div>
    </ProductShell>
  )
}