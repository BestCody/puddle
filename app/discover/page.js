import { AuthMessage } from '@/components/auth-message'
import { DiscoveryWorkspace } from '@/components/discovery-workspace'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getDiscoveryFeed, logDiscoveryImpressions } from '@/lib/app/discovery'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe date locations',
  description: 'Swipe through nearby places and save the ones that feel right for a date.'
}

export default async function DiscoverPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const feed = await getDiscoveryFeed(session, {
      kind: 'place',
      date: 'any',
      distance: session.profile.search_radius_km || 10,
      limit: 40
    })
    await logDiscoveryImpressions(session, feed)

    return <>
      <AuthMessage searchParams={searchParams} />
      <section className="date-swipe-heading">
        <div>
          <span className="section-pill">Your date deck</span>
          <h1>Swipe for somewhere worth going together.</h1>
          <p>Pass on places that are not your vibe. Save the ones you would actually choose for a date.</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡</span><strong>⌖</strong></div>
      </section>
      <DiscoveryWorkspace initialFeed={feed} />
    </>
  })
}
