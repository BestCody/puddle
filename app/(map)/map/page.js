import { Suspense } from 'react'
import { MapRouteClient } from '@/components/map-route-client'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Discover and map',
  description: 'Browse Puddle posts and explore Puddle locations on the map.'
}

function MapSnapshotPreload({ enabled }) {
  return enabled ? <link
    rel="preload"
    as="fetch"
    href="/api/map/snapshot"
    crossOrigin="use-credentials"
    fetchPriority="high"
  /> : null
}

function MapRouteLoading() {
  return <div className="puddle-route-stream-placeholder" role="status" aria-label="Loading Discover">
    <svg className="puddle-main-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.16" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 0" to="360 12 0" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  </div>
}

export default async function MapPage({ searchParams }) {
  const params = searchParams ? await searchParams : {}
  const mapView = params?.view === 'map'
  return <>
    <MapSnapshotPreload enabled={mapView} />
    <Suspense fallback={<MapRouteLoading />}><MapRouteClient /></Suspense>
  </>
}
