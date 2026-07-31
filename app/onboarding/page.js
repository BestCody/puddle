import { AuthMessage } from '@/components/auth-message'
import { BirthDateInput } from '@/components/birth-date-input'
import { SubmitButton } from '@/components/submit-button'
import { PuddleLogo } from '@/components/puddle-logo'
import { signOut } from '@/app/auth/actions'
import { completeDateOnboarding } from './actions'
import { requireUser } from '@/lib/auth/user'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Build your date deck' }

const dateLocationOptions = [
  { value: 'cafe', label: 'Coffee shops', detail: 'Coffee, tea, and easy conversation' },
  { value: 'restaurant', label: 'Restaurants', detail: 'Dinner, brunch, and tasting spots' },
  { value: 'bar', label: 'Bars & lounges', detail: 'Cocktails, mocktails, and late-night drinks' },
  { value: 'park', label: 'Parks & gardens', detail: 'Walks, picnics, and fresh air' },
  { value: 'museum', label: 'Museums', detail: 'Something interesting to explore together' },
  { value: 'gallery', label: 'Galleries', detail: 'Art, exhibits, and conversation starters' },
  { value: 'attraction', label: 'Local attractions', detail: 'Landmarks, aquariums, and city favourites' },
  { value: 'activity_venue', label: 'Activity dates', detail: 'Arcades, bowling, mini golf, and more' },
  { value: 'scenic_spot', label: 'Scenic spots', detail: 'Views, sunsets, and photo-worthy places' },
  { value: 'nightlife', label: 'Nightlife', detail: 'Dancing, live energy, and nights out' },
  { value: 'shop', label: 'Markets & bookstores', detail: 'Browse, wander, and discover something new' },
  { value: 'community_space', label: 'Community spaces', detail: 'Low-key local gems and shared experiences' }
]

export default async function OnboardingPage({ searchParams }) {
  const { user, profile } = await requireUser()
  if (profile?.onboarding_completed_at) redirect('/discover')
  const selectedLocations = new Set(profile?.interests || [])

  return (
    <div className="app-shell onboarding-shell">
      <header className="app-header onboarding-header">
        <PuddleLogo />
        <form className="onboarding-signout" action={signOut}>
          <button type="submit"><span aria-hidden="true">↗</span> Sign out</button>
        </form>
      </header>
      <main className="app-main onboarding-main">
        <span className="eyebrow">One quick setup</span>
        <h1 className="page-title">Build your date deck.</h1>
        <p className="muted onboarding-intro">Tell Puddle what kinds of places you enjoy on dates. We will use your choices, location, and swipes to find better options nearby.</p>
        <AuthMessage searchParams={searchParams} />
        <form className="settings-card full auth-form onboarding-card" action={completeDateOnboarding}>
          <div className="field-row">
            <label className="field">Display name<input name="display_name" defaultValue={profile?.display_name || user.user_metadata?.display_name || ''} required maxLength="60" autoComplete="name" /></label>
            <label className="field">Username<input name="username" defaultValue={profile?.username || ''} required pattern="[a-z0-9_]{3,24}" placeholder="ava_in_toronto" autoComplete="username" /></label>
          </div>
          <div className="field-row">
            <label className="field">Birth date<BirthDateInput defaultValue={profile?.birth_date || ''} /></label>
            <label className="field">City<input name="city" defaultValue={profile?.city || ''} placeholder="Toronto" required autoComplete="address-level2" /></label>
          </div>
          <label className="field">How far would you travel for a date?
            <span className="radius-control">
              <input aria-label="Search radius" name="search_radius_km" type="number" inputMode="numeric" min="1" max="100" step="1" defaultValue={profile?.search_radius_km || 10} required />
              <span className="radius-unit" aria-hidden="true">km</span>
            </span>
            <small className="field-hint">Choose any distance from 1 to 100 km.</small>
          </label>
          <fieldset className="field interest-fieldset date-location-fieldset">
            <legend>What kinds of places do you like for dates?</legend>
            <p className="date-location-help">Choose at least three. You can change these later as your taste evolves.</p>
            <div className="interest-grid date-location-grid">
              {dateLocationOptions.map((option) => (
                <label className="interest-chip date-location-chip" key={option.value}>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  <input type="checkbox" name="date_locations" value={option.value} defaultChecked={selectedLocations.has(option.value)} aria-label={option.label} />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">Your ideal date vibe<textarea name="bio" maxLength="500" defaultValue={profile?.bio || ''} placeholder="Low-key coffee, a walk somewhere pretty, and enough time to actually talk." /></label>
          <label className="field">Profile visibility<select name="profile_visibility" defaultValue="public"><option value="public">Public</option><option value="friends">Friends</option><option value="mutuals">Mutuals</option><option value="attendees">Confirmed attendees</option><option value="hidden">Hidden</option></select></label>
          <div className="onboarding-submit">
            <SubmitButton className="primary-button onboarding-primary" pendingText="Building your date deck…">Build my date deck →</SubmitButton>
          </div>
        </form>
      </main>
    </div>
  )
}
