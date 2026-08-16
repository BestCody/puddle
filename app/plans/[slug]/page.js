import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPublicLocation } from '@/lib/app/public-content'
import { planPlaceVisit, shareSavedPlace, togglePinnedPlace, toggleSavedPlace } from './actions'

export const dynamic = 'force-dynamic'

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dashboardSimilarHref(item) {
  if (item.content_kind === 'event') return `/events/${item.slug}`
  return `/plans/${item.slug}`
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const result = await getPublicLocation(slug)
  return { title: result?.location?.name || 'Saved place' }
}

function HiddenLocation({ location, slug }) {
  return <><input type="hidden" name="location_id" value={location.id} /><input type="hidden" name="slug" value={slug} /></>
}

export default async function SavedPlacePage({ params, searchParams }) {
  const { slug } = await params
  const query = await searchParams
  const result = await getPublicLocation(slug)
  if (!result) notFound()

  return renderProductPage(async (session) => {
    const { location, similar } = result
    const [{ data: savedState }, { data: friends }] = await Promise.all([
      session.supabase
        .from('user_content_states')
        .select('pinned_at')
        .eq('profile_id', session.user.id)
        .eq('location_id', location.id)
        .eq('state', 'saved')
        .maybeSingle(),
      session.supabase.rpc('social_friends_v1')
    ])
    const isSaved = Boolean(savedState)
    const isPinned = Boolean(savedState?.pinned_at)
    const friendList = friends || []

    const mapPoint = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)) ? [{
      id: location.id,
      location_id: location.id,
      title: location.name,
      summary: location.summary || location.description || '',
      category: location.kind,
      neighborhood: location.neighborhood,
      city: location.city,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      href: `/plans/${location.slug}`,
      photo_url: location.cover_url || location.gallery?.[0]?.url || null,
      states: [isSaved ? 'saved' : 'planned'],
      match: null,
      plan: null
    }] : []
    const mapCenter = mapPoint.length ? { latitude: mapPoint[0].latitude, longitude: mapPoint[0].longitude } : null
    const gallery = [location.cover_url, ...(location.gallery || []).map((item) => item.url)].filter(Boolean)

    return <div className="figma-saved-detail-screen">
      <AuthMessage searchParams={query} />
      <Link className="figma-saved-detail-back" href="/plans" aria-label="Back to Saved">‹</Link>
      <nav className="figma-dashboard-segment figma-saved-tabs" aria-label="Saved and plans"><Link className="is-active" href="/plans">Saved</Link><Link href="/plans?tab=planned">Plans</Link></nav>
      <div className="figma-saved-detail-rule" aria-hidden="true" />

      <article className="figma-saved-detail-card">
        <section className="figma-saved-detail-media">
          <div className="figma-saved-detail-hero" style={gallery[0] ? { backgroundImage: `url(${gallery[0]})` } : undefined}>
            {!gallery[0] ? <span>Puddle</span> : null}
          </div>
          <div className="figma-saved-detail-thumbs">{gallery.slice(1,4).map((url) => <img src={url} alt="" key={url} />)}</div>
        </section>

        <section className="figma-saved-detail-copy">
          <div className="figma-saved-detail-kicker"><span>{categoryLabel(location.kind)}</span>{location.city ? <span>{location.city}</span> : null}</div>
          <h1>{location.name}</h1>
          <p>{location.address_public || [location.neighborhood, location.city].filter(Boolean).join(', ')}</p>
          {location.summary || location.description ? <div className="figma-saved-detail-description">{location.summary || location.description}</div> : null}
          <div className="figma-saved-detail-actions">
            <form action={togglePinnedPlace}><HiddenLocation location={location} slug={slug} /><button type="submit">{isPinned ? 'Unpin' : 'Pin'}</button></form>
            <details className="figma-saved-detail-share"><summary>Share</summary><div>{friendList.length ? friendList.map((friend) => <form action={shareSavedPlace} key={friend.id}><HiddenLocation location={location} slug={slug} /><input type="hidden" name="friend_id" value={friend.id} /><button type="submit">{friend.display_name || friend.username || 'Friend'}</button></form>) : <p>Add a friend before sharing.</p>}</div></details>
            <form action={toggleSavedPlace}><HiddenLocation location={location} slug={slug} /><button className={isSaved ? 'is-saved' : ''} type="submit">{isSaved ? 'Unsave' : 'Save'}</button></form>
          </div>
          <details className="figma-saved-plan-visit">
            <summary>Plan a visit</summary>
            <form action={planPlaceVisit}>
              <HiddenLocation location={location} slug={slug} />
              <label>Date and time<input type="datetime-local" name="planned_for" required /></label>
              <label>Note<input name="note" maxLength="500" placeholder="Optional note" /></label>
              <button type="submit">Add to Plans</button>
            </form>
          </details>
          <div className="figma-saved-detail-tags">{(location.amenities || []).slice(0,6).map((value) => <span key={value}>{String(value).replaceAll('_',' ')}</span>)}</div>
        </section>

        <section className="figma-saved-detail-map">
          {mapPoint.length ? <LocationMap initialPoints={mapPoint} initialCenter={mapCenter} /> : <div className="figma-saved-detail-map-empty">Map unavailable</div>}
        </section>

        <section className="figma-saved-detail-reviews"><h2>Reviews</h2><p>No reviews yet.</p></section>
      </article>

      <section className="figma-saved-similar">
        <h2>Similar splashes</h2>
        <div>{similar.slice(0,3).map((item) => <Link className="figma-saved-similar-card" href={dashboardSimilarHref(item)} key={`${item.content_kind || 'place'}:${item.id}`}>
          <span style={item.cover_url ? { backgroundImage: `url(${item.cover_url})` } : undefined} />
          <small>{categoryLabel(item.category || item.kind)}</small>
          <strong>{item.title || item.name}</strong>
        </Link>)}</div>
      </section>

      <form className="figma-saved-floating-search figma-saved-detail-search" action="/plans" method="get"><label><span className="sr-only">Search saved puddles</span><input type="search" name="q" placeholder="Search a saved puddle..." /></label><button type="submit" aria-label="Search saved puddles">↑</button></form>
    </div>
  })
}
