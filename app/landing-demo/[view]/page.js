import { notFound } from 'next/navigation'
import { LandingPhoneDemo } from '@/components/landing-phone-demo'

const views = new Set(['swipe', 'save', 'feed', 'friends', 'pass', 'profile'])

// These previews must render per request so Next can attach the proxy-provided CSP nonce
// to its scripts. A force-static page renders visually but cannot hydrate under our strict CSP.
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Puddle interactive preview',
  robots: { index: false, follow: false }
}

export default async function LandingDemoPage({ params }) {
  const { view } = await params
  if (!views.has(view)) notFound()
  return <LandingPhoneDemo view={view} />
}
