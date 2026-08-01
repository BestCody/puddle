import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { EmptyState } from '@/components/empty-state'
import { LegacyPlansPage } from '@/app/plans/legacy-page'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'
import { legacySystemsEnabled } from '@/lib/product-vision'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved and planned locations' }

const tabs = [
  ['saved', 'Saved'],
  ['planned', 'Planned'],
  ['past', 'Past']
]

function LocationCard({ item }) {
  const timestamp = item.planned_for || item.visited_at || null
  return <article className="plan-content-card">
    <span>{item.status === 'planned' ? 'planned location' : item.status === 'visited' ? 'past location' : 'saved location'}</span>
    <h2><Link href={item.href}>{item.title}</Link></h2><p>{item.summary}</p>
    {item.city ? <small>{item.city}</small> : null}
    {timestamp ? <small>{new Date(timestamp).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</small> : null}
  </article>
}

export default async function PlansPage({ searchParams }) {
  if (legacySystemsEnabled()) return <LegacyPlansPage searchParams={searchParams} />
  const params = await searchParams
  const active = tabs.some(([value]) => value === params?.tab) ? params.tab : 'saved'

  return renderProductPage(async (session) => {
    const snapshot = await getLocationPlansSnapshot(session)
    const items = snapshot[active]
    return <>
      <section className="page-heading-row">
        <div><span className="section-pill section-pill-yellow">Your places</span><h1 className="product-title">Saved, planned, and actually visited.</h1><p>Puddle keeps this area focused on locations selected through solo swiping, DateMatch, or Hangout Match.</p></div>
        <div className="plans-heading-actions"><Link className="splash-button splash-button-mint" href="/map">Open map</Link><Link className="splash-button splash-button-pink" href="/discover">Swipe more locations</Link></div>
      </section>
      <AuthMessage searchParams={params} />
      {params?.legacy === 'disabled' ? <p className="date-swipe-message" role="status">That older Puddle feature is no longer part of the location-first product.</p> : null}
      <nav className="tab-rail" aria-label="Location plan categories">{tabs.map(([value, label]) => <Link className={active === value ? 'is-active' : ''} href={`/plans?tab=${value}`} key={value}><span>{label}</span><strong>{snapshot.counts[value] || 0}</strong></Link>)}</nav>
      {items.length ? <section className="plan-content-grid">{items.map((item) => <LocationCard item={item} key={`${active}:${item.location_id}`} />)}</section> : <EmptyState icon={active === 'planned' ? '⌖' : active === 'past' ? '✓' : '♡'} title={active === 'planned' ? 'No location planned yet.' : active === 'past' ? 'No past visits yet.' : 'No saved locations yet.'} description={active === 'planned' ? 'Choose a shared match and set a time when you are ready.' : active === 'past' ? 'Completed location plans will appear here.' : 'Save a location from your swipe deck to build a shortlist.'} actionHref="/discover" actionLabel="Start swiping" />}
    </>
  })
}
