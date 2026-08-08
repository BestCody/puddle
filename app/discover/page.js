import { after } from 'next/server'
import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { authorizeDiscoveryFeedB2Assets } from '@/lib/app/b2-feed-assets'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getInfrastructureDiscoveryFeedV2, recordSampledInfrastructureAnalyticsV2 } from '@/lib/app/discovery-infrastructure-v2'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Swipe',
  description: 'Swipe through nearby places.'
}

function textParam(value, max = 80) {
  return String(value || '').trim().slice(0, max)
}

function unavailableFeed(session, filters) {
  const latitude = Number(session.profile?.latitude)
  const longitude = Number(session.profile?.longitude)
  const hasCenter = Number.isFinite(latitude) && Number.isFinite(longitude)
  return {
    requestId: null,
    impressionKey: null,
    items: [],
    filters,
    center: hasCenter ? { latitude, longitude } : null,
    centerLabel: session.profile?.location_label || session.profile?.city || null,
    categories: [],
    recycled: false,
    emptyReason: null,
    fallback: true,
    fallbackReason: 'temporary_failure',
    rankingVersion: 'unavailable',
    experiment: { experiment: 'unavailable', variant: 'control', bucket: 0, holdout: false },
    rejections: [],
    personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      catalogue: 'unavailable',
      staticRelease: null,
      staticFetched: 0,
      staticServed: 0,
      relationalServed: 0,
      staticMaterialized: 0,
      staticTilesLoaded: 0,
      staticTilesRequested: 0,
      googleUiKitEligible: 0,
      overlayRpc: 'r2_discovery_overlay_v1',
      candidateCache: { status: 'bypass' },
      timings: { catalogueMs: 0, overlayMs: 0, totalMs: 0 }
    }
  }
}

export default async function DiscoverPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const requestedDistance = Number(params?.distance)
    const feedFilters = {
      kind: 'place',
      date: 'any',
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0
        ? Math.min(100, requestedDistance)
        : session.profile.search_radius_km || 10,
      limit: 12,
      q: textParam(params?.q),
      category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any',
      amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true',
      accessible: params?.accessible === 'true'
    }

    let feed
    try {
      const rawFeed = await getInfrastructureDiscoveryFeedV2(session, feedFilters)
      feed = await authorizeDiscoveryFeedB2Assets(rawFeed)
    } catch (error) {
      console.error(`Initial discovery feed failed: ${error?.message || 'unknown error'}`)
      feed = unavailableFeed(session, feedFilters)
    }

    after(() => recordSampledInfrastructureAnalyticsV2(session, feed)
      .catch((error) => console.warn(`Sampled discovery analytics failed: ${error.message}`)))

    return <div className="minimal-swipe-page">
      <AuthMessage searchParams={params} />
      <DateSwipeWorkspaceV2 initialFeed={feed} profileId={session.user.id} />
    </div>
  })
}
