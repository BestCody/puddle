import Link from 'next/link'
import { ProductShell } from '@/components/product-shell'
import { AuthMessage } from '@/components/auth-message'
import { LocationPicker } from '@/components/location-picker'
import { SubmitButton } from '@/components/submit-button'
import { deleteAccount, revokeOtherSessions, updatePassword } from '@/app/auth/actions'
import { updateDateProfile } from './actions'
import { requireUser } from '@/lib/auth/user'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account settings' }

const dateLocationOptions = [
  { value: 'cafe', label: 'Coffee shops' },
  { value: 'restaurant', label: 'Restaurants' },
  { value: 'bar', label: 'Bars & lounges' },
  { value: 'park', label: 'Parks & gardens' },
  { value: 'museum', label: 'Museums' },
  { value: 'gallery', label: 'Galleries' },
  { value: 'attraction', label: 'Local attractions' },
  { value: 'activity_venue', label: 'Activity dates' },
  { value: 'scenic_spot', label: 'Scenic spots' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'shop', label: 'Markets & bookstores' },
  { value: 'community_space', label: 'Community spaces' }
]

export default async function AccountPage({ searchParams }) {
  const { user, profile } = await requireUser({ onboarding: true })
  const sessionExpiry = user.aud ? 'Managed securely by Supabase Auth' : 'Active'
  const selectedLocations = new Set(profile?.interests || [])

  return (
    <ProductShell user={user} profile={profile}>
      <span className="section-pill section-pill-yellow">Your corner</span>
      <h1 className="product-title">Account settings.</h1>
      <AuthMessage searchParams={searchParams} />

      <div className="settings-grid">
        <form className="settings-card full" action={updateDateProfile}>
          <h2>Profile and preferences</h2>
          <p className="muted">Your selected location is converted to coordinates so Puddle can search nearby anywhere in the world.</p>
          <div className="field-row">
            <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || ''} required maxLength="60" /></label>
            <label className="field">Username<input name="username" defaultValue={profile?.username || ''} required pattern="[a-z0-9_]{3,24}" /></label>
          </div>
          <LocationPicker profile={profile} />
          <label className="field">Search radius<input name="search_radius_km" type="number" min="1" max="100" step="1" defaultValue={profile?.search_radius_km || 10} required /></label>
          <fieldset className="field interest-fieldset date-location-fieldset">
            <legend>What kinds of places do you like?</legend>
            <div className="interest-grid date-location-grid">
              {dateLocationOptions.map((option) => (
                <label className="interest-chip date-location-chip" key={option.value}>
                  <span><strong>{option.label}</strong></span>
                  <input type="checkbox" name="date_locations" value={option.value} defaultChecked={selectedLocations.has(option.value)} aria-label={option.label} />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">Your ideal date vibe<textarea name="bio" defaultValue={profile?.bio || ''} maxLength="500" placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk." /></label>
          <label className="field">Profile visibility<select name="profile_visibility" defaultValue={profile?.profile_visibility || 'public'}><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Shared-plan attendees</option><option value="hidden">Hidden</option></select></label>
          <SubmitButton pendingText="Saving preferences…">Save profile and preferences</SubmitButton>
        </form>

        <section className="settings-card">
          <h2>Email and password</h2>
          <div className="session-box">
            <strong>{user.email || 'No email available'}</strong>
            <p className="muted">Your sign-in email and security notifications use this address.</p>
          </div>
          <Link className="secondary-button" href="/change-email">Change email address</Link>

          <form className="auth-form" action={updatePassword}>
            <label className="field">New password<input name="password" type="password" minLength="10" required /></label>
            <label className="field">Confirm password<input name="password_confirmation" type="password" minLength="10" required /></label>
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
            <label className="field">Confirmation<input name="confirmation" autoComplete="off" required /></label>
            <SubmitButton className="danger-button" pendingText="Deleting…">Delete my account</SubmitButton>
          </form>
        </section>
      </div>
    </ProductShell>
  )
}
