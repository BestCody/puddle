import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getInfrastructureDiscoveryFeed, logInfrastructureDiscoveryImpressions } from '@/lib/app/discovery-infrastructure'

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
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0 ? Math.min(100, requestedDistance) : session.profile.search_radius_km || 10,
      limit: 12,
      q: textParam(params?.q),
      category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any',
      amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true',
      accessible: params?.accessible === 'true'
    }
    const feed = await getInfrastructureDiscoveryFeed(session, feedFilters)
    await logInfrastructureDiscoveryImpressions(session, feed)

    return <div className="minimal-swipe-page">
      <AuthMessage searchParams={params} />
      <DateSwipeWorkspaceV2 initialFeed={feed} />
    </div>
  })
}
