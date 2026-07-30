import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
import { PuddleLogo } from '@/components/puddle-logo'
import { completeOnboarding, saveOnboardingDraft, signOut } from '@/app/auth/actions'
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
    <div className="app-shell">
      <header className="app-header"><PuddleLogo /><form action={signOut}><button type="submit">Sign out</button></form></header>
      <main className="app-main">
        <span className="eyebrow">Step 1 of 1</span>
        <h1 className="page-title">Teach Puddle your vibe.</h1>
        <p className="muted">This powers your event feed and keeps social features age-appropriate. Save a draft at any point and continue after your next sign-in.</p>
        <AuthMessage searchParams={searchParams} />
        <form className="settings-card full auth-form" action={completeOnboarding}>
          <div className="field-row">
            <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || user.user_metadata?.display_name || ''} required maxLength="60" autoComplete="name" /></label>
            <label className="field">Username<input name="username" defaultValue={profile?.username || ''} required pattern="[a-z0-9_]{3,24}" placeholder="ava_in_toronto" autoComplete="username" /></label>
          </div>
          <div className="field-row">
            <label className="field">Birth date<input name="birth_date" type="date" defaultValue={profile?.birth_date || ''} required autoComplete="bday" /></label>
            <label className="field">City<input name="city" defaultValue={profile?.city || ''} placeholder="Toronto" required autoComplete="address-level2" /></label>
          </div>
          <label className="field">Search radius<select name="search_radius_km" defaultValue={profile?.search_radius_km || 10}><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option></select></label>
          <fieldset className="field"><legend>Pick at least three interests</legend><div className="interest-grid">{interests.map((interest)=><label key={interest}><input type="checkbox" name="interests" value={interest} defaultChecked={selectedInterests.has(interest)} /> {interest}</label>)}</div></fieldset>
          <label className="field">Tiny bio<textarea name="bio" maxLength="500" defaultValue={profile?.bio || ''} placeholder="Always down for live music, weird art, and good noodles." /></label>
          <label className="field">Profile visibility<select name="profile_visibility" defaultValue={profile?.profile_visibility || 'friends'}><option value="hidden">Hidden</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Confirmed attendees</option><option value="public">Public</option></select></label>
          <div className="editor-actions">
            <button className="secondary-button" type="submit" formAction={saveOnboardingDraft} formNoValidate>Save and continue later</button>
            <SubmitButton pendingText="Building your feed…">Build my feed →</SubmitButton>
          </div>
        </form>
      </main>
    </div>
  )
}
