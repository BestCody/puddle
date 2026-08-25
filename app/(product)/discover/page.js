import { after } from 'next/server'
import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { getDiscoveryFeed } from '@/lib/app/discovery'
import { recordSampledDiscoveryAnalytics } from '@/lib/app/discovery-analytics'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe',
  description: 'Swipe through nearby places.'
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
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0 ? requestedDistance : 10,
      limit: 12,
      q: '',
      category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any',
      amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true',
      accessible: params?.accessible === 'true'
    }

    // No degraded-feed fallback: a serving failure propagates and surfaces as a
    // request error instead of silently rendering an unavailable deck.
    const feed = await getDiscoveryFeed(session, feedFilters)

    after(() => recordSampledDiscoveryAnalytics(session, feed)
      .catch((error) => console.warn(`Sampled discovery analytics failed: ${error.message}`)))

    return <>
      <AuthMessage searchParams={params} />
      <DateSwipeWorkspaceV2 initialFeed={feed} profileId={session.user.id} />
    </>
  })
}
