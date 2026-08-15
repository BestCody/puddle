import { notFound } from 'next/navigation'
import { LandingPhoneDemo } from '@/components/landing-phone-demo'

const views = new Set(['swipe', 'save', 'feed', 'profile'])

export const dynamic = 'force-static'
export const metadata = {
  title: 'Puddle interactive preview',
  robots: { index: false, follow: false }
}

export function generateStaticParams() {
  return [...views].map((view) => ({ view }))
}

export default async function LandingDemoPage({ params }) {
  const { view } = await params
  if (!views.has(view)) notFound()
  return <LandingPhoneDemo view={view} />
}
