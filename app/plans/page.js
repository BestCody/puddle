import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { EmptyState } from '@/components/empty-state'
import { LegacyPlansPage } from '@/app/plans/legacy-page'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'
import { legacySystemsEnabled } from '@/lib/product-vision'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved and plans' }

const tabs = [['saved', 'Saved'], ['planned', 'Plans']]

function photoUrl(session, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function dateLabel(value) {
  if (!value) return null
  return new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function LocationCard({ item, session, active }) {
  const image = photoUrl(session, item.cover_path)
  const participants = item.participants?.length ? item.participants.join(', ') : null
  return <article className="minimal-place-card">
    <Link className="minimal-place-photo" href={item.href} style={image ? { backgroundImage: `url(${image})` } : undefined} aria-label={item.title} />
    <div className="minimal-place-copy">
      <span>{active === 'planned' ? 'Planned' : 'Saved'}</span>
      <h2><Link href={item.href}>{item.title}</Link></h2>
      {active === 'planned' && item.planned_for ? <small>{dateLabel(item.planned_for)}</small> : item.city ? <small>{item.city}</small> : null}
      {participants ? <p>{participants}</p> : null}
    </div>
    <details className="minimal-overflow"><summary aria-label={`Options for ${item.title}`}>•••</summary><div><Link href={item.href}>Open</Link>{item.city ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.title}, ${item.city}`)}`} target="_blank" rel="noreferrer">Map</a> : null}</div></details>
  </article>
}

export default async function PlansPage({ searchParams }) {
  if (legacySystemsEnabled()) return <LegacyPlansPage searchParams={searchParams} />
  const params = await searchParams
  const active = params?.tab === 'planned' ? 'planned' : params?.tab === 'past' ? 'past' : 'saved'

  return renderProductPage(async (session) => {
    const snapshot = await getLocationPlansSnapshot(session)
    const items = snapshot[active]
    return <div className="minimal-list-page">
      <header className="minimal-page-header"><h1>{active === 'past' ? 'History' : 'Saved'}</h1><Link href="/discover">Swipe</Link></header>
      <AuthMessage searchParams={params} />
      <nav className="minimal-tabs" aria-label="Saved and plans">{tabs.map(([value, label]) => <Link className={active === value ? 'is-active' : ''} href={`/plans?tab=${value}`} key={value}>{label}</Link>)}</nav>
      {items.length ? <section className="minimal-place-grid">{items.map((item) => <LocationCard item={item} session={session} active={active} key={`${active}:${item.location_id}`} />)}</section> : <EmptyState icon="♡" title={active === 'planned' ? 'No plans yet.' : active === 'past' ? 'No history yet.' : 'Nothing saved yet.'} description={active === 'planned' ? 'Plan a matched place when everyone is ready.' : active === 'past' ? 'Past visits appear here.' : 'Save a place while swiping.'} actionHref="/discover" actionLabel="Start swiping" />}
      <footer className="minimal-history-link">{active === 'past' ? <Link href="/plans">Back to Saved</Link> : <Link href="/plans?tab=past">History</Link>}</footer>
    </div>
  })
}
