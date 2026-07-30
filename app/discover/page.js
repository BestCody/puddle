import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { DiscoveryWorkspace } from '@/components/discovery-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Discover' }

export default async function DiscoverPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, { distance: session.profile.search_radius_km || 25, limit: 40 })
    await logDiscoveryImpressions(session, feed)
    return <>
      <AuthMessage searchParams={searchParams} />
      <section className="product-hero product-hero-pink"><div><span className="section-pill">Your next plan</span><h1>Swipe into something good.</h1><p>Nearby events and places ranked by transparent rules, optional local embeddings, and signals you control.</p></div><div className="hero-orbit" aria-hidden="true"><span>EVENT</span><span>PLACE</span><strong>✦</strong></div></section>
      <div className="product-toolbar"><span className="muted">Eligibility, distance, timing, interests, activity, similarity, and variety shape the order.</span><div><Link className="text-link" href="/settings/recommendations">Recommendation settings →</Link><Link className="text-link" href="/plans">Open my plans →</Link></div></div>
      <DiscoveryWorkspace initialFeed={feed} defaultMode="deck" />
    </>
  })
}
