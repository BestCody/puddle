import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { SavedLocationMorphBridge } from '@/components/saved-location-morph-bridge'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPublicLocation } from '@/lib/app/public-content'
import { getLocationPlanStatus } from '@/lib/app/location-plans-data'
import { savedLocationTransitionNames } from '@/lib/app/saved-location-transition'
import { planPlaceVisit, togglePinnedPlace, toggleSavedPlace } from './actions'
import { DetailReviews } from './detail-reviews'
import { DetailShareMenu } from './detail-share-menu'
import { SimilarPlaces } from './similar-places'
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
  // Public catalogue data and the authenticated session are independent. Start
  // the cached location read before authentication so cold B2 work overlaps the
  // profile lookup instead of forming a request waterfall.
  const resultPromise = getPublicLocation(slug)

  return renderProductPage(async (session) => {
    const result = await resultPromise
    if (!result) notFound()
    const { location } = result
    const [{ data: savedState }, plannedItem] = await Promise.all([
      session.supabase
        .from('user_content_states')
        .select('pinned_at')
        .eq('profile_id', session.user.id)
        .eq('location_id', location.id)
        .eq('state', 'saved')
        .maybeSingle(),
      getLocationPlanStatus(session, location.id)
    ])
    const isSaved = Boolean(savedState)
    const isPinned = Boolean(savedState?.pinned_at)
    const mapStates = [isSaved ? 'saved' : null, plannedItem ? 'planned' : null].filter(Boolean)
    const folders = [location.kind].filter(Boolean)
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
          {folders.map((folder) => <Link href={`/plans?tab=saved&category=${encodeURIComponent(folder)}`} key={folder}><span aria-hidden="true">{categoryIcon(folder)}</span>{categoryLabel(folder)}</Link>)}
        </nav>
      </div>

      <article className={styles.detailCard} data-testid="saved-detail-card" style={{ viewTransitionName: transitionNames.card }}>
        <div className={styles.detailLeft}>
          <section className={styles.detailMedia} aria-label={`${location.name} photo`} data-testid="saved-detail-media">
            <div className={styles.detailHero} style={{ ...(gallery[0] ? { backgroundImage: `url(${gallery[0]})` } : {}), viewTransitionName: transitionNames.photo }} />
          </section>

          <div className={styles.detailActions} aria-label="Saved place actions">
            <form action={togglePinnedPlace}><HiddenLocation location={location} slug={slug} /><button className={styles.pinButton} type="submit">{isPinned ? 'Unpin' : 'Pin'}</button></form>
            <DetailShareMenu locationId={location.id} slug={slug} />
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

          <DetailReviews locationId={location.id} slug={slug} userId={session.user.id} />
        </div>

        <section className={styles.detailMap} data-testid="saved-detail-map">
          {mapPoint.length ? <LocationMap initialPoints={mapPoint} initialCenter={mapCenter} /> : <div className={styles.mapEmpty}>Map unavailable</div>}
        </section>
      </article>

      <SimilarPlaces slug={slug} />

      <form className={`${styles.floatingSearch} ${styles.detailSearch}`} action="/plans" method="get" data-testid="saved-detail-search">
        <input type="hidden" name="tab" value="saved" />
        <label><input aria-label="Search saved puddles" type="search" name="q" placeholder="Search a saved puddle..." /></label>
        <button type="submit" aria-label="Search saved puddles">↑</button>
      </form>
    </div>
  })
}
