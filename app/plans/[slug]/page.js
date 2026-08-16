import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPublicLocation } from '@/lib/app/public-content'
import { planPlaceVisit, shareSavedPlace, togglePinnedPlace, toggleSavedPlace } from './actions'
import styles from '../Plans.module.css'

export const dynamic = 'force-dynamic'

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dashboardSimilarHref(item) {
  if (item.content_kind === 'event') return `/events/${item.slug}`
  return `/plans/${item.slug}`
}

function similarTitle(item) {
  return item.title || item.name || 'Puddle'
}

function similarLocation(item) {
  return item.city || item.location?.city || categoryLabel(item.category || item.kind)
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
    const placeLabel = location.city || location.neighborhood || categoryLabel(location.kind)

    return <div className={styles.detailScreen} data-figma-node="38:223" data-testid="saved-detail-screen">
      <AuthMessage searchParams={query} />

      <header className={styles.detailTopbar}>
        <Link className={styles.detailBack} href="/plans" aria-label="Back to Saved">‹</Link>
        <nav className={`figma-dashboard-segment ${styles.tabs} ${styles.detailTabs}`} aria-label="Saved and plans" data-testid="saved-detail-tabs">
          <Link className={styles.active} href="/plans">Saved</Link>
          <Link href="/plans?tab=planned">Plans</Link>
        </nav>
      </header>

      <div className={styles.detailCategoryBand}>
        <nav className={styles.detailCategories} aria-label="Saved categories">
          <Link className={styles.detailCategoryActive} href="/plans?tab=saved">All</Link>
          <Link href="/plans?tab=saved&category=court"><span aria-hidden="true">◉</span>Courts</Link>
          <Link href="/plans?tab=saved&category=theatre"><span aria-hidden="true">▦</span>Theatres</Link>
          <Link className={styles.detailMore} href="/plans?tab=saved" aria-label="More saved categories">+</Link>
        </nav>
      </div>

      <article className={styles.detailCard} data-testid="saved-detail-card">
        <div className={styles.detailLeft}>
          <section className={styles.detailMedia} aria-label={`${location.name} photo`} data-testid="saved-detail-media">
            <div className={styles.detailHero} style={gallery[0] ? { backgroundImage: `url(${gallery[0]})` } : undefined} />
          </section>

          <div className={styles.detailActions} aria-label="Saved place actions">
            <form action={togglePinnedPlace}><HiddenLocation location={location} slug={slug} /><button className={styles.pinButton} type="submit">{isPinned ? 'Unpin' : 'Pin'}</button></form>
            <details className={styles.share}>
              <summary aria-label="Share saved place"><img src="/figma/saved-place-share.svg" alt="" aria-hidden="true" /></summary>
              <div>{friendList.length ? friendList.map((friend) => <form action={shareSavedPlace} key={friend.id}><HiddenLocation location={location} slug={slug} /><input type="hidden" name="friend_id" value={friend.id} /><button type="submit">{friend.display_name || friend.username || 'Friend'}</button></form>) : <p>Add a friend before sharing.</p>}</div>
            </details>
            <form action={toggleSavedPlace}><HiddenLocation location={location} slug={slug} /><button className={styles.unsaveButton} type="submit">{isSaved ? 'Unsave' : 'Save'}</button></form>
          </div>

          <h1 className={styles.detailTitle}>{location.name}</h1>
          <div className={styles.detailMeta} aria-label="Place details">
            <span className={styles.cityMeta}>{placeLabel}</span>
            <span className={styles.priceMeta}>Price varies</span>
            <span className={styles.localMeta}>Local spot</span>
          </div>

          <details className={styles.planVisit}>
            <summary>Plan a visit</summary>
            <form action={planPlaceVisit}>
              <HiddenLocation location={location} slug={slug} />
              <label>Date and time<input type="datetime-local" name="planned_for" required /></label>
              <label>Note<input name="note" maxLength="500" placeholder="Optional note" /></label>
              <button type="submit">Add to Plans</button>
            </form>
          </details>

          <section className={styles.reviews}><h2>Reviews</h2><p>No reviews yet.</p></section>
        </div>

        <section className={styles.detailMap} data-testid="saved-detail-map">
          {mapPoint.length ? <LocationMap initialPoints={mapPoint} initialCenter={mapCenter} /> : <div className={styles.mapEmpty}>Map unavailable</div>}
        </section>
      </article>

      <section className={styles.similar} data-testid="saved-similar">
        <h2>Similar splashes</h2>
        <div className={styles.similarGrid}>{similar.slice(0, 3).map((item) => <Link className={styles.similarCard} href={dashboardSimilarHref(item)} key={`${item.content_kind || 'place'}:${item.id}`}>
          <span className={styles.similarPhoto} style={item.cover_url ? { backgroundImage: `url(${item.cover_url})` } : undefined} />
          <strong>{similarTitle(item)}</strong>
          <small><span>{similarLocation(item)}</span>{Number.isFinite(Number(item.distance_km)) ? <b>{Number(item.distance_km).toFixed(1)} km</b> : null}</small>
        </Link>)}</div>
      </section>

      <form className={`${styles.floatingSearch} ${styles.detailSearch}`} action="/plans" method="get" data-testid="saved-detail-search">
        <input type="hidden" name="tab" value="saved" />
        <label><input aria-label="Search saved puddles" type="search" name="q" placeholder="Search a saved puddle..." /></label>
        <button type="submit" aria-label="Search saved puddles">↑</button>
      </form>
    </div>
  })
}
