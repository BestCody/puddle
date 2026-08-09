import { AuthMessage } from '@/components/auth-message'
import { OnboardingForm } from '@/components/onboarding-form'
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
        <p className="muted onboarding-intro">Tell Puddle what kinds of places you enjoy. We use your selected location and swipes to find nearby options anywhere in the world.</p>
        <AuthMessage searchParams={searchParams} />
        <OnboardingForm
          action={completeDateOnboarding}
          profile={profile || {}}
          userDisplayName={user.user_metadata?.display_name || ''}
          dateLocationOptions={dateLocationOptions}
        />
      </main>
    </div>
  )
}
