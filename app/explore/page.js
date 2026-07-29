import { DiscoveryWorkspace } from '@/components/discovery-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Explore' }

export default function ExplorePage() {
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, { distance: session.profile.search_radius_km || 25, limit: 80 })
    await logDiscoveryImpressions(session, feed)
    return (
      <>
        <section className="page-heading-row"><div><span className="section-pill section-pill-mint">Map the fun</span><h1 className="product-title">Explore nearby.</h1><p>Search, filter, compare, and move between the real list and map without leaving Puddle.</p></div></section>
        <DiscoveryWorkspace initialFeed={feed} defaultMode="map" />
      </>
    )
  })
}
