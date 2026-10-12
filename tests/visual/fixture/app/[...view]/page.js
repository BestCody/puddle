import { VisualFixture } from '../visual-fixture'
import AccountPage from '@/app/account/page'
import ProfilePage from '@/app/(product)/profile/page'
import PlansPage from '@/app/(product)/plans/page'
import MembershipPage from '@/app/(product)/membership/page'
import CreatePostPage from '@/app/(product)/create/post/page'
import ReportPage from '@/app/report/page'
import { StaticProductShell } from '@/components/static-product-shell'
import SignUpPage from '@/app/signup/page'
import ForgotPasswordPage from '@/app/forgot-password/page'
import OnboardingPage from '@/app/onboarding/page'
import PrivacyPage from '@/app/privacy/page'
import TermsPage from '@/app/terms/page'
import NotFound from '@/app/not-found'
import { PublicLocationView } from '@/components/public-listing'
import { PlaceHub } from '@/components/place-hub'
import { LocationEditor } from '@/components/location-editor'
import { LegalPage, LegalSection } from '@/components/legal-page'
import { LandingPhoneDemo } from '@/components/landing-phone-demo'
import '@/app/landing-phone-demo.css'
import ProductLoading from '@/app/(product)/loading'
import { RecommendationSettings } from '@/components/recommendation-settings'
import { places, photo } from '../../mocks/data'

export default async function VisualPage({ params, searchParams }) {
  const { view } = await params
  const query = await searchParams
  const route = view.join('/')
  if (view[0] === 'landing-demo') return <LandingPhoneDemo view={view[1]} />
  const Page = { account: AccountPage, profile: ProfilePage, plans: PlansPage, membership: MembershipPage, 'create/post': CreatePostPage, report: ReportPage, signup: SignUpPage, 'forgot-password': ForgotPasswordPage, onboarding: OnboardingPage, privacy: PrivacyPage, terms: TermsPage, 'not-found': NotFound }[route]
  if (Page) return <Page searchParams={Promise.resolve(query)} />
  if (route === 'streaming-shell') return <StaticProductShell><h1>Saved appearance</h1></StaticProductShell>
  if (route === 'loading') return <VisualFixture view="loading"><ProductLoading /></VisualFixture>
  if (route === 'recommendations') return <VisualFixture view="recommendations"><RecommendationSettings initialPreferences={{ behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false }} /></VisualFixture>
  if (route === 'public/place') return <PublicLocationView location={{ ...places[0], cover_url: photo, summary: 'A quiet green space to enjoy together.', description: 'Explore the paths and meet your friends by the lake.', timezone: 'America/Toronto', tags: ['outdoors'], gallery: [{ id: 'photo', url: photo }] }} />
  if (route === 'public/city') return <PlaceHub title="Places in Oakville" intro="Discover somewhere worth going." places={places.map(place => ({ ...place, coverUrl: photo, categoryLabel: 'Park' }))} />
  if (route === 'editor') return <VisualFixture view="editor"><LocationEditor location={places[0]} identities={[{ id: '', kind: 'personal', name: 'Alex' }]} /></VisualFixture>
  if (route === 'legal') return <LegalPage title="Privacy Policy" summary="Your information and your choices." updated="October 2026" companionHref="/terms" companionLabel="Terms"><LegalSection id="data" title="Your data"><p>Your preferences belong to you.</p></LegalSection></LegalPage>
  return <VisualFixture view={route} tab={query.tab || 'messages'} conversationId={query.conversation || null} />
}
