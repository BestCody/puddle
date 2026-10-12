import onboardingStyles from "@/components/onboarding.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { AuthMessage } from '@/components/auth-message'
import { OnboardingForm } from '@/components/onboarding-form'
import { signOut } from '@/app/auth/actions'
import { completeDateOnboarding } from './actions'
import { requireUser } from '@/lib/auth/user'
import { redirect } from 'next/navigation'
import { PROFILE_INTEREST_OPTIONS } from '@/lib/app/profile-interests'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Build your date deck' }

export default async function OnboardingPage({ searchParams }) {
  const { user, profile } = await requireUser()
  if (profile?.onboarding_completed_at) redirect('/discover')

  // Figma: Puddle Official / Changes / Onboarding — the setup flow is a centred
  // widget floating over a blurred view of the product.
  return (
    <div className={scopedClasses(onboardingStyles, "pdl-onb-page")}>
      <div className={scopedClasses(onboardingStyles, "pdl-onb-site")} aria-hidden="true" />
      <div className={scopedClasses(onboardingStyles, "pdl-onb-scrim")} aria-hidden="true" />
      <div className={scopedClasses(onboardingStyles, "pdl-onb-flash")}><AuthMessage searchParams={searchParams} /></div>
      <OnboardingForm
        action={completeDateOnboarding}
        profile={profile || {}}
        userDisplayName={user.user_metadata?.display_name || ''}
        dateLocationOptions={PROFILE_INTEREST_OPTIONS}
        signOutAction={signOut}
      />
    </div>
  )
}
