import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe date locations',
  description: 'Swipe through a curated set of nearby date locations and invite someone to find mutual favourites.'
}

function textParam(value, max = 80) {
  return String(value || '').trim().slice(0, max)
}

export default async function DiscoverPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const requestedDistance = Number(params?.distance)
    const feedFilters = {
      kind: 'place',
      date: 'any',
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0 ? Math.min(100, requestedDistance) : session.profile.search_radius_km || 10,
      limit: 12,
      q: textParam(params?.q),
      category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any',
      amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true',
      accessible: params?.accessible === 'true'
    }
    const feed = await getDiscoveryFeed(session, feedFilters)
    await logDiscoveryImpressions(session, feed)

    return <>
      <AuthMessage searchParams={params} />
      {params?.legacy === 'disabled' ? <p className="date-swipe-message" role="status">That older Puddle feature is no longer part of the location-first product. Your location deck is ready here.</p> : null}
      <section className="date-swipe-heading swipe-v2-heading">
        <div>
          <span className="section-pill">Your 12-card location deck</span>
          <h1>Find somewhere you actually want to go.</h1>
          <p>Real photos and useful descriptions come first. Pass what misses, save what works, and use Perfect Pick when a place immediately stands out.</p>
        </div>
        <div className="swipe-heading-demo" aria-hidden="true"><span>↶</span><strong>×</strong><strong>♥</strong><span>★</span></div>
      </section>
      <DateSwipeWorkspaceV2 initialFeed={feed} />
    </>
  })
}
