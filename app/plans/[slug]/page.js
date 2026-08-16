import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPublicLocation } from '@/lib/app/public-content'

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

export default async function SavedPlacePage({ params }) {
  const { slug } = await params
  const result = await getPublicLocation(slug)
  if (!result) notFound()

  return renderProductPage(async () => {
    const { location, similar } = result
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
      states: ['saved'],
      match: null,
      plan: null
    }] : []
    const mapCenter = mapPoint.length ? { latitude: mapPoint[0].latitude, longitude: mapPoint[0].longitude } : null
    const gallery = [location.cover_url, ...(location.gallery || []).map((item) => item.url)].filter(Boolean)

    return <div className="figma-saved-detail-screen">
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
          <div className="figma-saved-detail-actions"><button type="button" disabled>Pin</button><button type="button" disabled>Share</button><span>Saved</span></div>
          <Link className="figma-saved-plan-visit" href="/plans?tab=planned">Plan a visit</Link>
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
