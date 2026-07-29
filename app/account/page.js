import Link from 'next/link'
import { PuddleLogo } from '@/components/puddle-logo'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { deleteAccount, revokeOtherSessions, signOut, updateEmail, updatePassword, updateProfile } from '@/app/auth/actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account settings' }

export default async function AccountPage({ searchParams }) {
  const { user, profile } = await requireUser()
  const sessionExpiry = user.aud ? 'Managed securely by Supabase Auth' : 'Active'
  return (
    <div className="app-shell">
      <header className="app-header"><PuddleLogo /><nav className="app-nav"><Link href="/dashboard">Dashboard</Link><form action={signOut}><button type="submit">Sign out</button></form></nav></header>
      <main className="app-main">
        <span className="eyebrow">Your corner</span><h1 className="page-title">Account settings.</h1><AuthMessage searchParams={searchParams} />
        <div className="settings-grid">
          <form className="settings-card" action={updateProfile}><h2>Public profile</h2><label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || ''} required /></label><label className="field">Username<input name="username" defaultValue={profile?.username || ''} required /></label><label className="field">City<input name="city" defaultValue={profile?.city || ''} /></label><label className="field">Bio<textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" /></label><label className="field">Search radius<input name="search_radius_km" type="number" min="1" max="100" defaultValue={profile?.search_radius_km || 10} /></label><label className="field">Visibility<select name="profile_visibility" defaultValue={profile?.profile_visibility || 'friends'}><option value="hidden">Hidden</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Attendees</option><option value="public">Public</option></select></label><SubmitButton>Save profile</SubmitButton></form>
          <section className="settings-card"><h2>Email and password</h2><form className="auth-form" action={updateEmail}><label className="field">Email<input name="email" type="email" defaultValue={user.email || ''} required /></label><SubmitButton className="secondary-button">Change email</SubmitButton></form><form className="auth-form" action={updatePassword}><label className="field">New password<input name="password" type="password" minLength="10" required /></label><label className="field">Confirm password<input name="password_confirmation" type="password" minLength="10" required /></label><SubmitButton>Change password</SubmitButton></form></section>
          <section className="settings-card full"><h2>Sessions</h2><div className="session-box"><strong>Current browser</strong><p className="muted">{sessionExpiry}. Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Unavailable'}.</p></div><form action={revokeOtherSessions}><SubmitButton className="secondary-button">Sign out every other session</SubmitButton></form></section>
          <section className="settings-card full danger-zone"><h2>Delete account</h2><p className="muted">This permanently removes the Supabase Auth user and cascades through Puddle records. Type <span className="code-hint">DELETE</span> to continue.</p><form className="auth-form" action={deleteAccount}><label className="field">Confirmation<input name="confirmation" autoComplete="off" required /></label><SubmitButton className="danger-button" pendingText="Deleting…">Delete my account</SubmitButton></form></section>
        </div>
      </main>
    </div>
  )
}
