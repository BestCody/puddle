import Link from 'next/link'
import { ProductShell } from '@/components/product-shell'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { UsernameInput } from '@/components/username-input'
import { deleteAccount, revokeOtherSessions, updatePassword } from '@/app/auth/actions'
import { updateDateProfile } from './actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

export default async function AccountPage({ searchParams }) {
  const { user, profile } = await requireUser({ onboarding: true })
  const sessionExpiry = user.aud ? 'Managed securely by Supabase Auth' : 'Active'

  return (
    <ProductShell user={user} profile={profile}>
      <div className="figma-settings-page">
        <aside className="figma-settings-sidebar" aria-label="Settings sections">
          <strong>Settings</strong>
          <nav>
            <a href="#profile">Profile</a>
            <a href="#security">Email / Password</a>
            <span aria-disabled="true">Appearance</span>
            <a href="#sessions">Sessions</a>
            <Link href="/membership?view=manage">Billing</Link>
            <a href="#account">Account</a>
          </nav>
        </aside>

        <div className="figma-settings-content">
          <AuthMessage searchParams={searchParams} />

          <form className="settings-card full" id="profile" action={updateDateProfile}>
            <header><small>Profile</small><h1>Profile settings</h1></header>
            <p className="muted">Manage the details friends see. Swipe location and place preferences stay in Discover filters.</p>
            <div className="field-row">
              <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></label>
              <label className="field">Username<UsernameInput defaultValue={profile?.username || ''} id="account-username" /></label>
            </div>
            <label className="field">Your ideal date vibe<textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk." /><small className="field-hint">500 characters maximum.</small></label>
            <label className="field">Profile visibility<select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></label>
            <SubmitButton pendingText="Saving profile…">Save profile</SubmitButton>
          </form>

          <section className="settings-card" id="security">
            <header><small>Email / Password</small><h2>Sign-in security</h2></header>
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

          <section className="settings-card" id="sessions">
            <header><small>Sessions</small><h2>Signed-in devices</h2></header>
            <div className="session-box">
              <strong>Current browser</strong>
              <p className="muted">{sessionExpiry}. Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}.</p>
            </div>
            <form action={revokeOtherSessions}>
              <SubmitButton className="secondary-button">Sign out every other session</SubmitButton>
            </form>
          </section>

          <section className="settings-card full danger-zone" id="account">
            <header><small>Account</small><h2>Delete account</h2></header>
            <p className="muted">This permanently removes your account and associated Puddle records. Type <span className="code-hint">DELETE</span> to continue.</p>
            <form className="auth-form" action={deleteAccount}>
              <label className="field">Confirmation<input name="confirmation" autoComplete="off" required minLength="6" maxLength="6" pattern="DELETE" /></label>
              <SubmitButton className="danger-button" pendingText="Deleting…">Delete my account</SubmitButton>
            </form>
          </section>
        </div>
      </div>
    </ProductShell>
  )
}
