import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Feed and map',
  description: 'Browse your Puddle places as a feed or map.'
}

function avatarUrl(session) {
  const path = session.profile?.avatar_path
  if (!path) return null
  if (String(path).startsWith('/') || String(path).startsWith('http')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function FeedCard({ point, session, avatar }) {
  const category = String(point.category || 'place').replaceAll('_',' ')
  const stateLabel = point.states.includes('planned') ? 'Planned' : point.states.includes('matched') ? 'Matched' : 'Saved'
  return <article className="figma-feed-card">
    <header className="figma-feed-author">
      <span className="figma-feed-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(session.profile?.display_name)}</span>
      <div><strong>{session.profile?.display_name || 'You'}</strong><small>{stateLabel} in Puddle</small></div>
    </header>
    <p className="figma-feed-note">{point.summary}</p>
    <Link className="figma-feed-photo" href={point.href} style={point.photo_url ? { backgroundImage: `url(${point.photo_url})` } : undefined} aria-label={`Open ${point.title}`}>
      {!point.photo_url ? <span className="figma-photo-placeholder">Puddle</span> : null}
    </Link>
    <Link className="figma-feed-place" href={point.href}>
      <span>{category}</span>
      <h2>{point.title}</h2>
      <small>{point.neighborhood || point.city || stateLabel}</small>
      <b aria-hidden="true">+</b>
    </Link>
    <footer className="figma-feed-actions">
      <Link href={point.href}>Details</Link>
      <Link href={`/plans?tab=${point.states.includes('planned') ? 'planned' : 'saved'}`}>{stateLabel}</Link>
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.title}, ${point.city || ''}`)}`} target="_blank" rel="noreferrer">Map</a>
    </footer>
  </article>
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim().toLowerCase() : ''

  return renderProductPage(async (session) => {
    const snapshot = await getLocationMapSnapshot(session)
    const avatar = avatarUrl(session)
    const points = query ? snapshot.points.filter((point) => `${point.title} ${point.city || ''} ${point.category || ''}`.toLowerCase().includes(query)) : snapshot.points

    return <div className="figma-feed-page">
      <nav className="figma-segmented-tabs figma-feed-segment" aria-label="Feed or map">
        <Link className={view === 'feed' ? 'is-active' : ''} href="/map">Feed</Link>
        <Link className={view === 'map' ? 'is-active' : ''} href="/map?view=map">Map</Link>
      </nav>

      <form className="figma-feed-search" action="/map" method="get">
        {view === 'map' ? <input type="hidden" name="view" value="map" /> : null}
        <label><span className="sr-only">Search Puddle</span><input type="search" name="q" defaultValue={params?.q || ''} placeholder="Search puddle" /></label>
        <button type="submit" aria-label="Search">⌕</button>
      </form>

      {view === 'map' ? <section className="figma-map-view">
        <div className="figma-map-stats"><span>{snapshot.counts.saved} saved</span><span>{snapshot.counts.matched} matched</span><span>{snapshot.counts.planned} planned</span></div>
        {points.length ? <LocationMap initialPoints={points} initialCenter={snapshot.center} /> : <EmptyState icon="⌖" title="Nothing to map yet." description="Save a location or create a shared match and it will appear here." actionHref="/discover" actionLabel="Start swiping" />}
      </section> : <>
        <section className="figma-feed-list" aria-label="Puddle feed">
          {points.length ? points.map((point) => <FeedCard point={point} session={session} avatar={avatar} key={point.id} />) : <EmptyState icon="○" title={query ? 'No puddles match that search.' : 'Your feed is ready for its first puddle.'} description={query ? 'Try a different place or city.' : 'Save a place while swiping and it will show up here.'} actionHref="/discover" actionLabel="Start swiping" />}
        </section>
        <Link className="figma-feed-compose" href="/create/place"><span className="figma-feed-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(session.profile?.display_name)}</span><span>Create a puddle...</span><b>↑</b></Link>
      </>}
    </div>
  })
}
