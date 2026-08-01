import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspace } from '@/components/date-swipe-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe date locations',
  description: 'Swipe through a curated set of nearby date ideas and invite someone to find mutual favourites.'
}

export default async function DiscoverPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, {
      kind: 'place',
      date: 'any',
      distance: session.profile.search_radius_km || 10,
      limit: 12
    })
    await logDiscoveryImpressions(session, feed)

    return <>
      <AuthMessage searchParams={searchParams} />
      <section className="date-swipe-heading">
        <div>
          <span className="section-pill">Your 12-card date deck</span>
          <h1>Swipe for somewhere worth going together.</h1>
          <p>Pass, save, or mark a Perfect Pick. Finish with a useful shortlist—or invite someone to privately swipe the same deck and reveal mutual DateMatches.</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡</span><strong>⇄</strong></div>
      </section>
      <DateSwipeWorkspace initialFeed={feed} googleMapsBrowserKey={process.env.GOOGLE_MAPS_BROWSER_KEY || ''} />
    </>
  })
}
