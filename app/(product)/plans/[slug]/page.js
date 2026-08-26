import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { SavedLocationMorphBridge } from '@/components/saved-location-morph-bridge'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPublicLocation } from '@/lib/app/public-content'
import { getLocationPlanStatus, getLocationPlansPage } from '@/lib/app/location-plans-data'
import { savedLocationTransitionNames } from '@/lib/app/saved-location-transition'
import { deletePlaceReview, planPlaceVisit, shareSavedPlace, togglePinnedPlace, toggleSavedPlace, upsertPlaceReview } from './actions'
import styles from '../Plans.module.css'

export const dynamic = 'force-dynamic'

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function categoryIcon(value) {
  const label = String(value || '').toLowerCase()
  if (label.includes('theatre') || label.includes('theater')) return '▦'
  if (label.includes('court')) return '◉'
  if (label.includes('coffee') || label.includes('cafe')) return '♨'
  return '•'
}

function folderKey(item) {
  return item?.folder || item?.category || item?.kind || 'Saved'
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

function ReviewEditor({ location, slug, review }) {
  return <form action={upsertPlaceReview} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
    <HiddenLocation location={location} slug={slug} />
    <label style={{ display: 'grid', gap: 4, font: '700 12px/1.2 Manrope, sans-serif' }}>
      Your rating
      <select name="rating" defaultValue={String(review?.rating || 5)} aria-label="Your rating" style={{ width: 150, minHeight: 34, border: '1.5px solid #d7d7d7', borderRadius: 10, padding: '0 8px', background: '#fff' }}>
        <option value="5">5 — Excellent</option>
        <option value="4">4 — Great</option>
        <option value="3">3 — Good</option>
        <option value="2">2 — Fair</option>
        <option value="1">1 — Poor</option>
      </select>
    </label>
    <textarea name="body" defaultValue={review?.body || ''} maxLength="2000" placeholder="Share what you thought..." aria-label="Review" style={{ width: '100%', minHeight: 62, resize: 'vertical', border: '1.5px solid #d7d7d7', borderRadius: 12, padding: 9, boxSizing: 'border-box', font: '500 13px/1.35 Manrope, sans-serif' }} />
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="submit" style={{ minHeight: 32, padding: '0 13px', border: 0, borderRadius: 999, background: '#b784e4', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{review ? 'Update review' : 'Post review'}</button>
    </div>
  </form>
}

export default async function SavedPlacePage({ params, searchParams }) {
  const { slug } = await params
  const query = await searchParams
  // Public catalogue data and the authenticated session are independent. Start
  // the cached location read before authentication so cold B2 work overlaps the
  // profile lookup instead of forming a request waterfall.
  const resultPromise = getPublicLocation(slug)

  return renderProductPage(async (session) => {
    const result = await resultPromise
    if (!result) notFound()
    const { location, similar } = result
    const [{ data: savedState }, { data: friends }, { data: reviews }, savedPage, plannedItem] = await Promise.all([
      session.supabase
        .from('user_content_states')
        .select('pinned_at')
        .eq('profile_id', session.user.id)
        .eq('location_id', location.id)
        .eq('state', 'saved')
        .maybeSingle(),
      session.supabase.rpc('social_friends_v2'),
      session.supabase.rpc('location_reviews_v1', { target_location: location.id }),
      getLocationPlansPage(session, { tab: 'saved' }),
      getLocationPlanStatus(session, location.id)
    ])
    const isSaved = Boolean(savedState)
    const isPinned = Boolean(savedState?.pinned_at)
    const mapStates = [isSaved ? 'saved' : null, plannedItem ? 'planned' : null].filter(Boolean)
    const friendList = friends || []
    const reviewList = reviews || []
    const myReview = reviewList.find((review) => review.author_id === session.user.id) || null
    const averageRating = reviewList.length ? reviewList.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviewList.length : null
    const folders = [...new Set((savedPage?.items || []).map(folderKey).filter(Boolean))]
    const primaryFolders = folders.slice(0, 2)
    const overflowFolders = folders.slice(2)
    const transitionNames = savedLocationTransitionNames(location.id)

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
      states: mapStates.length ? mapStates : ['catalogue'],
      match: null,
      plan: plannedItem ? { planned_for: plannedItem.planned_for, source: plannedItem.plan_source } : null
    }] : []
    const mapCenter = mapPoint.length ? { latitude: mapPoint[0].latitude, longitude: mapPoint[0].longitude } : null
    const gallery = [location.cover_url, ...(location.gallery || []).map((item) => item.url)].filter(Boolean)
    const placeLabel = location.city || location.neighborhood || categoryLabel(location.kind)

    return <div className={styles.detailScreen} data-figma-node="38:223" data-testid="saved-detail-screen">
      <SavedLocationMorphBridge detailLocationId={location.id} />
      <AuthMessage searchParams={query} />

      <header className={styles.detailTopbar}>
        <a className={styles.detailBack} href="/plans" aria-label="Back to Saved" data-saved-morph-back>‹</a>
        <nav className={`figma-dashboard-segment ${styles.tabs} ${styles.detailTabs}`} aria-label="Saved and plans" data-testid="saved-detail-tabs">
          <Link className={styles.active} href="/plans">Saved</Link>
          <Link href="/plans?tab=planned">Plans</Link>
        </nav>
      </header>

      <div className={styles.detailCategoryBand}>
        <nav className={styles.detailCategories} aria-label="Saved categories">
          <Link className={styles.detailCategoryActive} href="/plans?tab=saved">All</Link>
          {primaryFolders.map((folder) => <Link href={`/plans?tab=saved&category=${encodeURIComponent(folder)}`} key={folder}><span aria-hidden="true">{categoryIcon(folder)}</span>{categoryLabel(folder)}</Link>)}
          {overflowFolders.length ? <details className={styles.moreCategories}>
            <summary aria-label="More saved categories">+</summary>
            <div>{overflowFolders.map((folder) => <Link href={`/plans?tab=saved&category=${encodeURIComponent(folder)}`} key={folder}>{categoryLabel(folder)}</Link>)}</div>
          </details> : null}
        </nav>
      </div>

      <article className={styles.detailCard} data-testid="saved-detail-card" style={{ viewTransitionName: transitionNames.card }}>
        <div className={styles.detailLeft}>
          <section className={styles.detailMedia} aria-label={`${location.name} photo`} data-testid="saved-detail-media">
            <div className={styles.detailHero} style={{ ...(gallery[0] ? { backgroundImage: `url(${gallery[0]})` } : {}), viewTransitionName: transitionNames.photo }} />
          </section>

          <div className={styles.detailActions} aria-label="Saved place actions">
            <form action={togglePinnedPlace}><HiddenLocation location={location} slug={slug} /><button className={styles.pinButton} type="submit">{isPinned ? 'Unpin' : 'Pin'}</button></form>
            <details className={styles.share}>
              <summary aria-label="Share saved place"><img src="/figma/saved-place-share.svg" alt="" aria-hidden="true" /></summary>
              <div>{friendList.length ? friendList.map((friend) => <form action={shareSavedPlace} key={friend.id}><HiddenLocation location={location} slug={slug} /><input type="hidden" name="friend_id" value={friend.id} /><button type="submit">{friend.display_name || friend.username || 'Friend'}</button></form>) : <p>Add a friend before sharing.</p>}</div>
            </details>
            <form action={toggleSavedPlace}><HiddenLocation location={location} slug={slug} /><button className={styles.unsaveButton} type="submit">{isSaved ? 'Unsave' : 'Save'}</button></form>
          </div>

          <h1 className={styles.detailTitle} style={{ viewTransitionName: transitionNames.title }}>{location.name}</h1>
          <div className={styles.detailMeta} aria-label="Place details" style={{ viewTransitionName: transitionNames.meta }}>
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

          <section className={styles.reviews} style={{ overflowY: 'auto', paddingBottom: 18 }} data-testid="saved-place-reviews">
            <h2>Reviews{averageRating ? ` · ${averageRating.toFixed(1)} / 5 (${reviewList.length})` : ''}</h2>
            <div style={{ padding: '0 20px 18px' }}>
              <ReviewEditor location={location} slug={slug} review={myReview} />
              {myReview ? <form action={deletePlaceReview} style={{ marginTop: 7 }}><HiddenLocation location={location} slug={slug} /><button type="submit" style={{ border: 0, background: 'transparent', padding: 0, color: '#777', font: '700 12px/1.2 Manrope, sans-serif', textDecoration: 'underline', cursor: 'pointer' }}>Delete my review</button></form> : null}
              <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
                {reviewList.length ? reviewList.map((review) => <article key={review.id} style={{ paddingTop: 9, borderTop: '1px solid #ececec' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: '700 13px/1.2 Manrope, sans-serif' }}><strong>{review.display_name || review.username || 'Puddle person'}</strong><span aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</span></div>
                  {review.body ? <div style={{ marginTop: 5, color: '#555', font: '500 13px/1.35 Manrope, sans-serif' }}>{review.body}</div> : null}
                </article>) : <div style={{ marginTop: 14, color: '#777', font: '600 13px/1.3 Manrope, sans-serif' }}>No reviews yet. Be the first to review this place.</div>}
              </div>
            </div>
          </section>
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
