import { Suspense } from 'react'
import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { InstantSegment } from '@/components/instant-segment'
import { LocationMap } from '@/components/location-map'
import { DiscoverSearchOverlay } from '@/components/discover-search-overlay'
import { SocialFeedClient } from '@/components/social-feed-client'
import { renderProductPage } from '@/lib/app/render-product-page'
import styles from './MapFeed.module.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Discover and map',
  description: 'Browse Puddle posts and explore Puddle locations on the map.'
}

// The map view owns the catalogue data graph. The feed uses its authenticated
// API after the product shell has streamed, so opening the feed does not wait
// for server-rendered post markup.
async function getLocationMapSnapshot(session) {
  const mapData = await import('@/lib/app/location-map-data')
  return mapData.getLocationMapSnapshot(session)
}

function FeedTop({ view, query }) {
  return <header className={styles.header} data-testid="feed-header">
    <Link className={styles.back} href="/discover" aria-label="Back to Swipe">â€¹</Link>
    <InstantSegment className={styles.tabs} tone="yellow" activeValue={view} ariaLabel="Posts or map" testId="feed-tabs" items={[{ value: 'feed', label: 'Posts', href: '/map' }, { value: 'map', label: 'Map', href: '/map?view=map' }]} />
    {view === 'feed' ? <DiscoverSearchOverlay initialQuery={query || ''} /> : <span aria-hidden="true" />}
  </header>
}

function MapScreen({ points, center, heatmap = [], passActive = false, selectingForPost = false }) {
  return <section className={styles.mapScreen} data-testid="feed-map-canvas">
    {selectingForPost ? <div className={styles.mapSelectionNotice}><strong>Choose a place for your post.</strong><Link href="/map?compose=1">Cancel</Link></div> : null}
    <div className={styles.mapCanvas}><LocationMap initialPoints={points} initialCenter={center} heatmapPoints={heatmap} passActive={passActive && !selectingForPost} loadCatalogue selectingForPost={selectingForPost} /></div>
  </section>
}

function StreamPlaceholder({ label }) {
  return <div className={styles.empty} role="status" aria-label={label}><strong>Loadingâ€¦</strong></div>
}

async function MapScreenSlot({ mapPromise, selectingForPost }) {
  const mapSnapshot = await mapPromise
  const mapPoints = selectingForPost
    ? mapSnapshot.points.map((point) => ({ ...point, href: `/map?compose=1&location=${encodeURIComponent(point.id)}` }))
    : mapSnapshot.points
  return <MapScreen
    points={mapPoints}
    center={mapSnapshot.center}
    heatmap={mapSnapshot.heatmap}
    passActive={mapSnapshot.passActive}
    selectingForPost={selectingForPost}
  />
}

function profileAvatarUrl(session) {
  const path = String(session.profile?.avatar_path || '').trim()
  if (!path) return null
  if (path.startsWith('/') || /^https?:\/\//i.test(path)) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim() : ''
  const selectingForPost = view === 'map' && params?.selectForPost === '1'
  const beforeCreatedAt = typeof params?.before === 'string' ? params.before : null
  const beforePostId = typeof params?.beforeId === 'string' ? params.beforeId : null
  const initialComposerOpen = view === 'feed' && params?.compose === '1'
  const requestedLocation = typeof params?.location === 'string' ? params.location : ''

  return renderProductPage(async (session) => {
    const mapPromise = view === 'map' ? getLocationMapSnapshot(session) : null

    return <>
      <AuthMessage searchParams={params} />
      <div className={`${styles.screen} ${view === 'map' ? styles.mapMode : ''}`} data-testid="feed-screen" data-view={view}>
        <FeedTop view={view} query={params?.q} />
        {view === 'map' ? <Suspense fallback={<StreamPlaceholder label="Loading map" />}>
          <MapScreenSlot mapPromise={mapPromise} selectingForPost={selectingForPost} />
        </Suspense> : <SocialFeedClient
          query={query}
          beforeCreatedAt={beforeCreatedAt}
          beforePostId={beforePostId}
          avatarUrl={profileAvatarUrl(session)}
          displayName={session.profile?.display_name || 'Puddle person'}
          initialOpen={initialComposerOpen}
          requestedLocation={requestedLocation}
        />}
      </div>
    </>
  })
}
