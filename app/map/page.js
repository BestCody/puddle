import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Saved and matched map',
  description: 'Compare only the locations you saved, matched on, or planned.'
}

export default async function LocationMapPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getLocationMapSnapshot(session)
    return <div className="focused-map-page">
      <section className="page-heading-row map-page-heading">
        <div><span className="section-pill section-pill-mint">Your location map</span><h1 className="product-title">See where your real options are.</h1><p>This map contains only places you saved, matched on, or planned. It never opens the retired event-discovery map.</p></div>
        <div className="map-page-actions"><Link className="splash-button splash-button-yellow" href="/plans">Open lists</Link><Link className="splash-button splash-button-pink" href="/discover">Swipe more</Link></div>
      </section>
      <section className="map-page-metrics" aria-label="Mapped location counts"><span><strong>{snapshot.counts.saved}</strong> Saved</span><span><strong>{snapshot.counts.matched}</strong> Matches</span><span><strong>{snapshot.counts.planned}</strong> Planned</span></section>
      {snapshot.points.length ? <LocationMap initialPoints={snapshot.points} initialCenter={snapshot.center} /> : <EmptyState icon="⌖" title="Nothing to map yet." description="Save a location or create a shared match and it will appear here." actionHref="/discover" actionLabel="Start swiping" />}
    </div>
  })
}
