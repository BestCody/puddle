import Link from 'next/link'
import { DiscoveryWorkspace } from '@/components/discovery-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Discover' }

export default async function DiscoverPage() {
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, { distance: session.profile.search_radius_km || 25, limit: 40 })
    await logDiscoveryImpressions(session, feed)
    return (
      <>
        <section className="product-hero product-hero-pink">
          <div><span className="section-pill">Your next plan</span><h1>Swipe into something good.</h1><p>Real nearby events and places, ranked with transparent rules instead of a black box.</p></div>
          <div className="hero-orbit" aria-hidden="true"><span>EVENT</span><span>PLACE</span><strong>✦</strong></div>
        </section>
        <div className="product-toolbar"><span className="muted">Distance, timing, interests, availability, and variety shape the order.</span><Link className="text-link" href="/plans">Open my plans →</Link></div>
        <DiscoveryWorkspace initialFeed={feed} defaultMode="deck" />
      </>
    )
  })
}
