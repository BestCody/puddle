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

  return <ProductShell user={user} profile={profile}>
    <div className="figma-settings-screen">
      <section className="figma-settings-window" aria-label="Settings">
        <a className="figma-settings-close" href="/account" aria-label="Close settings details">×</a>
        <aside className="figma-settings-local-nav">
          <strong>Settings</strong>
          <nav>
            <a href="#profile">Profile</a>
            <a href="#security">Email / Password</a>
            <a href="#appearance">Appearance</a>
            <a href="#sessions">Sessions</a>
            <a href="#billing">Billing</a>
            <a href="#account">Account</a>
          </nav>
        </aside>

        <div className="figma-settings-detail">
          <AuthMessage searchParams={searchParams} />

          <form className="figma-settings-section" id="profile" action={updateDateProfile}>
            <header><small>Profile</small><h1>Profile</h1></header>
            <div className="figma-settings-row"><label>Display name</label><input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></div>
            <div className="figma-settings-row"><label>Username</label><UsernameInput defaultValue={profile?.username || ''} id="account-username" /></div>
            <div className="figma-settings-row is-tall"><label>About</label><textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" /></div>
            <div className="figma-settings-row"><label>Visibility</label><select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></div>
            <div className="figma-settings-submit"><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
          </form>

          <section className="figma-settings-section" id="security">
            <header><small>Email / Password</small><h1>Email / Password</h1></header>
            <div className="figma-settings-row"><label>Email</label><span>{user.email || 'No email available'}</span><Link href="/change-email">Change</Link></div>
            <form action={updatePassword}>
              <div className="figma-settings-row"><label>New password</label><input name="password" type="password" minLength="10" maxLength="128" required /></div>
              <div className="figma-settings-row"><label>Confirm password</label><input name="password_confirmation" type="password" minLength="10" maxLength="128" required /></div>
              <div className="figma-settings-submit"><SubmitButton>Change password</SubmitButton></div>
            </form>
          </section>

          <section className="figma-settings-section" id="appearance">
            <header><small>Appearance</small><h1>Appearance</h1></header>
            <div className="figma-settings-row"><label>Theme</label><span>Light</span></div>
            <div className="figma-settings-row"><label>Interface</label><span>Puddle default</span></div>
          </section>

          <section className="figma-settings-section" id="sessions">
            <header><small>Sessions</small><h1>Session</h1></header>
            <div className="figma-settings-row is-tall"><label>Current browser</label><span>{sessionExpiry}<br />Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}</span></div>
            <form action={revokeOtherSessions}><div className="figma-settings-submit"><SubmitButton>Sign out other sessions</SubmitButton></div></form>
          </section>

          <section className="figma-settings-section" id="billing">
            <header><small>Billing</small><h1>Billing</h1></header>
            <div className="figma-settings-row"><label>Puddle Pass</label><Link href="/membership?view=manage">Manage billing</Link></div>
          </section>

          <section className="figma-settings-section" id="account">
            <header><small>Account</small><h1>Account</h1></header>
            <p className="figma-settings-warning">Permanently delete your Puddle account and associated records.</p>
            <form action={deleteAccount}>
              <div className="figma-settings-row"><label>Type DELETE</label><input name="confirmation" autoComplete="off" required minLength="6" maxLength="6" pattern="DELETE" /></div>
              <div className="figma-settings-submit is-danger"><SubmitButton pendingText="Deleting…">Delete my account</SubmitButton></div>
            </form>
          </section>
        </div>
      </section>
    </div>
  </ProductShell>
}
