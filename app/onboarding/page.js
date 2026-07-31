import { AuthMessage } from '@/components/auth-message'
import { BirthDateInput } from '@/components/birth-date-input'
import { SubmitButton } from '@/components/submit-button'
import { PuddleLogo } from '@/components/puddle-logo'
import { completeOnboarding, signOut } from '@/app/auth/actions'
import { requireUser } from '@/lib/auth/user'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Build your vibe' }
const interests = ['Live music','Nightlife','Food','Pop-ups','Art','Film','Workshops','Sports','Wellness','Markets','Comedy','Outdoors']

export default async function OnboardingPage({ searchParams }) {
  const { user, profile } = await requireUser()
  if (profile?.onboarding_completed_at) redirect('/dashboard')
  const selectedInterests = new Set(profile?.interests || [])

  return (
    <div className="app-shell onboarding-shell">
      <header className="app-header onboarding-header">
        <PuddleLogo />
        <form className="onboarding-signout" action={signOut}>
          <button type="submit"><span aria-hidden="true">↗</span> Sign out</button>
        </form>
      </header>
      <main className="app-main onboarding-main">
        <span className="eyebrow">Step 1 of 1</span>
        <h1 className="page-title">Teach Puddle your vibe.</h1>
        <p className="muted onboarding-intro">This powers your event feed and keeps social features age-appropriate.</p>
        <AuthMessage searchParams={searchParams} />
        <form className="settings-card full auth-form onboarding-card" action={completeOnboarding}>
          <div className="field-row">
            <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || user.user_metadata?.display_name || ''} required maxLength="60" autoComplete="name" /></label>
            <label className="field">Username<input name="username" defaultValue={profile?.username || ''} required pattern="[a-z0-9_]{3,24}" placeholder="ava_in_toronto" autoComplete="username" /></label>
          </div>
          <div className="field-row">
            <label className="field">Birth date<BirthDateInput defaultValue={profile?.birth_date || ''} /></label>
            <label className="field">City<input name="city" defaultValue={profile?.city || ''} placeholder="Toronto" required autoComplete="address-level2" /></label>
          </div>
          <label className="field">Search radius
            <span className="radius-control">
              <input name="search_radius_km" type="number" inputMode="numeric" min="1" max="100" step="1" defaultValue={profile?.search_radius_km || 10} required />
              <span className="radius-unit" aria-hidden="true">km</span>
            </span>
            <small className="field-hint">Choose any distance from 1 to 100 km.</small>
          </label>
          <fieldset className="field interest-fieldset">
            <legend>Pick at least three interests</legend>
            <div className="interest-grid">{interests.map((interest)=><label className="interest-chip" key={interest}><span>{interest}</span><input type="checkbox" name="interests" value={interest} defaultChecked={selectedInterests.has(interest)} /></label>)}</div>
          </fieldset>
          <label className="field">Tiny bio<textarea name="bio" maxLength="500" defaultValue={profile?.bio || ''} placeholder="Always down for live music, weird art, and good noodles." /></label>
          <label className="field">Profile visibility<select name="profile_visibility" defaultValue="public"><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Confirmed attendees</option><option value="hidden">Hidden</option></select></label>
          <div className="onboarding-submit">
            <SubmitButton className="primary-button onboarding-primary" pendingText="Building your feed…">Build my feed →</SubmitButton>
          </div>
        </form>
      </main>
    </div>
  )
}
