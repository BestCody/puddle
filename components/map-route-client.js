"use client"

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { InstantSegment } from '@/components/instant-segment'
import { LocationMap } from '@/components/location-map'
import { DiscoverSearchOverlay } from '@/components/discover-search-overlay'
import { SocialFeedClient } from '@/components/social-feed-client'
import styles from '@/app/(product)/map/MapFeed.module.css'

const DEFAULT_MAP_CENTER = { latitude: 43.6532, longitude: -79.3832 }

function FeedTop({ view, query }) {
  return <header className={styles.header} data-testid="feed-header">
    <Link className={styles.back} href="/discover" aria-label="Back to Swipe">‹</Link>
    <InstantSegment className={styles.tabs} tone="yellow" activeValue={view} ariaLabel="Posts or map" testId="feed-tabs" items={[{ value: 'feed', label: 'Posts', href: '/map' }, { value: 'map', label: 'Map', href: '/map?view=map' }]} />
    {view === 'feed' ? <DiscoverSearchOverlay initialQuery={query} /> : <span aria-hidden="true" />}
  </header>
}

function AuthMessageClient({ params }) {
  const error = params.get('error')
  const success = params.get('success')
  if (!error && !success) return null
  return <p className={`auth-message ${error ? 'is-error' : 'is-success'}`}>{error || success}</p>
}

function MapScreen({ selectingForPost }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    // The map page emits a credentialed fetch preload for this fixed endpoint.
    // Default cache mode lets hydration consume that preload while the API's
    // private no-store response still prevents browser persistence.
    fetch('/api/map/snapshot', { cache: 'default', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          if (payload?.code === 'onboarding_required') window.location.assign('/onboarding')
          throw new Error(payload?.error || `Map snapshot returned ${response.status}`)
        }
        return payload
      })
      .then((payload) => {
        if (!controller.signal.aborted) setSnapshot(payload)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          console.warn('Could not load map snapshot.', { message: cause?.message || 'unknown error' })
          setError('The map could not be loaded.')
        }
      })

    return () => controller.abort()
  }, [reload])

  const mapPoints = snapshot?.points?.map((point) => selectingForPost
    ? { ...point, href: `/create/post?location=${encodeURIComponent(point.id)}` }
    : point) || []

  return <section className={styles.mapScreen} data-testid="feed-map-canvas">
    {selectingForPost ? <div className={styles.mapSelectionNotice}><strong>Choose a place for your post.</strong><Link href="/map?compose=1">Cancel</Link></div> : null}
    {error ? <div className={styles.mapEmpty} role="alert"><strong>Could not load the map.</strong><small>Check your connection and try again.</small><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>
      : snapshot ? <div className={styles.mapCanvas}><LocationMap
        key={`${selectingForPost ? 'select' : 'browse'}:${snapshot.self?.display_name || 'map'}`}
        initialPoints={mapPoints}
        initialCenter={snapshot.center || DEFAULT_MAP_CENTER}
        heatmapPoints={snapshot.heatmap || []}
        passActive={Boolean(snapshot.passActive) && !selectingForPost}
        loadCatalogue
        selectingForPost={selectingForPost}
      /></div>
        : <div className={styles.mapEmpty} role="status" aria-label="Loading map"><strong>Loading map…</strong></div>}
  </section>
}

export function MapRouteClient() {
  const params = useSearchParams()
  const view = params.get('view') === 'map' ? 'map' : 'feed'
  const query = params.get('q') || ''
  const selectingForPost = view === 'map' && params.get('selectForPost') === '1'
  const beforeCreatedAt = params.get('before') || null
  const beforePostId = params.get('beforeId') || null
  const initialComposerOpen = view === 'feed' && params.get('compose') === '1'
  const requestedLocation = params.get('location') || ''

  return <>
    <AuthMessageClient params={params} />
    <div className={`${styles.screen} ${view === 'map' ? styles.mapMode : ''}`} data-testid="feed-screen" data-view={view}>
      <FeedTop view={view} query={query} />
      {view === 'map' ? <MapScreen selectingForPost={selectingForPost} /> : <SocialFeedClient
        query={query}
        beforeCreatedAt={beforeCreatedAt}
        beforePostId={beforePostId}
        initialOpen={initialComposerOpen}
        requestedLocation={requestedLocation}
      />}
    </div>
  </>
}
