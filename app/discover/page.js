import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspace } from '@/components/date-swipe-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe date locations',
  description: 'Swipe through a curated set of nearby date locations and invite someone to find mutual favourites.'
}

export default async function DiscoverPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, {
      kind: 'place',
      date: 'any',
      distance: session.profile.search_radius_km || 10,
      limit: 12
    })
    await logDiscoveryImpressions(session, feed)

    return <>
      <AuthMessage searchParams={params} />
      {params?.legacy === 'disabled' ? <p className="date-swipe-message" role="status">That older Puddle feature is no longer part of the location-first product. Your location deck is ready here.</p> : null}
      <section className="date-swipe-heading">
        <div>
          <span className="section-pill">Your 12-card date deck</span>
          <h1>Swipe for somewhere worth going together.</h1>
          <p>Pass, save, or mark a Perfect Pick. Image-rich locations with useful descriptions come first, followed by the places with the strongest trusted Puddle ratings.</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡</span><strong>⇄</strong></div>
      </section>
      <DateSwipeWorkspace initialFeed={feed} />
    </>
  })
}
