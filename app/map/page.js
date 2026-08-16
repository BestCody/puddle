import Link from 'next/link'
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

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function detailHref(point) {
  const slug = String(point.href || '').match(/^\/places\/(.+)$/)?.[1]
  return slug ? `/plans/${slug}` : point.href
}

function FeedPost({ point, session, avatar }) {
  const name = session.profile?.display_name || 'You'
  const stateLabel = point.states.includes('planned') ? 'Planned' : point.states.includes('matched') ? 'Matched' : 'Saved'
  const href = detailHref(point)
  return <article className="figma-feed-post">
    <header className="figma-feed-post-author">
      <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
      <span><strong>{name}</strong><small>{stateLabel} in Puddle</small></span>
    </header>

    <p className="figma-feed-post-copy">{point.summary}</p>

    <div className="figma-feed-post-photos" aria-label={`${point.title} photos`}>
      <Link href={href} className="is-main" style={point.photo_url ? { backgroundImage: `url(${point.photo_url})` } : undefined} aria-label={`Open ${point.title}`} />
      <Link href={href} style={point.photo_url ? { backgroundImage: `url(${point.photo_url})` } : undefined} aria-label={`Open ${point.title} photo`} />
      <Link href={href} className="is-more" aria-label={`Open ${point.title}`}>+30</Link>
    </div>

    <Link className="figma-feed-post-place" href={href}>
      <span>{categoryLabel(point.category)}</span>
      <small>{point.neighborhood || point.city || stateLabel}</small>
      <h2>{point.title}</h2>
      <b aria-hidden="true">+</b>
    </Link>

    <footer className="figma-feed-post-interactions" aria-label="Post actions">
      <Link href="/matches" aria-label="Comment">◯</Link>
      <Link href={href} aria-label="Open puddle">◒</Link>
      <Link href="/plans" aria-label="Saved">♡</Link>
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.title}, ${point.city || ''}`)}`} target="_blank" rel="noreferrer" aria-label="Share or open map">↗</a>
    </footer>
  </article>
}

function FeedTop({ view, query }) {
  return <>
    <Link className="figma-feed-back" href="/discover" aria-label="Back to Swipe">‹</Link>
    <nav className="figma-dashboard-segment figma-feed-tabs" aria-label="Feed or map">
      <Link className={view === 'feed' ? 'is-active' : ''} href="/map">Feed</Link>
      <Link className={view === 'map' ? 'is-active' : ''} href="/map?view=map">Map</Link>
    </nav>
    {view === 'feed' ? <form className="figma-feed-search" action="/map" method="get">
      <label><span className="sr-only">Search Puddle</span><input type="search" name="q" defaultValue={query || ''} placeholder="Search puddle" /></label>
      <button type="submit" aria-label="Search">⌕</button>
    </form> : null}
  </>
}

function MapScreen({ points, center }) {
  const first = points[0]
  return <section className="figma-feed-map-screen">
    <div className="figma-feed-map-canvas">{points.length ? <LocationMap initialPoints={points} initialCenter={center} /> : <div className="figma-feed-map-empty">Save a place to see it on your map.</div>}</div>
    {first ? <>
      <div className="figma-feed-map-puddle" aria-hidden="true" />
      <Link className="figma-feed-map-card" href={detailHref(first)}>
        <span>{categoryLabel(first.category)}</span><small>{first.city || first.neighborhood || ''}</small><strong>{first.title}</strong><b>+</b>
      </Link>
    </> : null}
  </section>
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim().toLowerCase() : ''

  return renderProductPage(async (session) => {
    const snapshot = await getLocationMapSnapshot(session)
    const avatar = avatarUrl(session)
    const points = query ? snapshot.points.filter((point) => `${point.title} ${point.city || ''} ${point.category || ''}`.toLowerCase().includes(query)) : snapshot.points

    return <div className={`figma-feed-screen is-${view}`}>
      <FeedTop view={view} query={params?.q} />
      {view === 'map' ? <MapScreen points={points} center={snapshot.center} /> : <>
        <section className="figma-feed-stream" aria-label="Puddle feed">
          {points.length ? points.map((point) => <FeedPost point={point} session={session} avatar={avatar} key={point.id} />) : <div className="figma-feed-empty"><strong>{query ? 'No puddles match that search.' : 'Your feed is ready for its first puddle.'}</strong><Link href="/discover">Start swiping</Link></div>}
        </section>
        <Link className="figma-feed-composer" href="/create/post">
          <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(session.profile?.display_name)}</span>
          <span>Create a puddle...</span><b>↑</b>
        </Link>
      </>}
    </div>
  })
}
