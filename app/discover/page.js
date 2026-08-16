import { after } from 'next/server'
import { AuthMessage } from '@/components/auth-message'
import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { getRelationalDiscoveryFeed } from '@/lib/app/discovery-relational'
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
    continuation: { excluded: 0, candidateLimit: 0, hasMore: false },
    fallback: true,
    fallbackReason: 'temporary_failure',
    rankingVersion: 'unavailable',
    experiment: { experiment: 'unavailable', variant: 'control', bucket: 0, holdout: false },
    rejections: [],
    personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
    infrastructure: {
      source: 'supabase-relational',
      relationalServed: 0,
      googleUiKitEligible: 0,
      overlayRpc: 'r2_discovery_overlay_v2',
      timings: { queryMs: 0, totalMs: 0 }
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
      distance: Number.isFinite(requestedDistance) && requestedDistance > 0 ? requestedDistance : 10,
      limit: 12,
      q: '',
      category: textParam(params?.category, 40),
      price: textParam(params?.price, 10) || 'any',
      amenity: textParam(params?.amenity, 60),
      openNow: params?.openNow === 'true',
      accessible: params?.accessible === 'true'
    }

    let feed
    try {
      feed = await getRelationalDiscoveryFeed(session, feedFilters)
    } catch (error) {
      console.error(`Initial discovery feed failed: ${error?.message || 'unknown error'}`)
      feed = unavailableFeed(session, feedFilters)
    }

    after(() => recordSampledDiscoveryAnalytics(session, feed)
      .catch((error) => console.warn(`Sampled discovery analytics failed: ${error.message}`)))

    return <>
      <AuthMessage searchParams={params} />
      <DateSwipeWorkspaceV2 initialFeed={feed} profileId={session.user.id} />
    </>
  })
}
