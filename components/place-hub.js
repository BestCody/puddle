import Link from 'next/link'
import { PublicHeader } from './public-listing'
import { marketPath } from '@/lib/app/seo-places'

// Hub pages are the only crawlable path into /places/[slug], so every list here renders as
// real anchors in the server HTML. Cover art uses a plain <img> with explicit dimensions
// rather than the client-side PhotoFrame: a crawler should not need to run JavaScript to
// see the link, and the fixed box keeps these grids off the layout-shift budget.

const CARD_IMAGE_WIDTH = 230
const CARD_IMAGE_HEIGHT = 150

export function categoryLinks(market, categories) {
  return categories.map((category) => ({
    href: marketPath(market, category),
    label: `${category.label} in ${market.name}`
  }))
}

export function marketLinks(markets) {
  return markets.map((market) => ({ href: marketPath(market), label: market.name }))
}

function Breadcrumbs({ trail }) {
  if (!trail?.length) return null
  return <nav className="place-hub-breadcrumbs" aria-label="Breadcrumb">
    <ol>
      {trail.map((crumb, index) => {
        const isCurrent = index === trail.length - 1
        return <li key={crumb.href || crumb.label}>
          {isCurrent || !crumb.href
            ? <span aria-current={isCurrent ? 'page' : undefined}>{crumb.label}</span>
            : <Link href={crumb.href}>{crumb.label}</Link>}
        </li>
      })}
    </ol>
  </nav>
}

function PlaceCard({ place }) {
  return <li className="place-hub-card">
    <Link href={`/places/${place.slug}`}>
      {place.coverUrl
        ? <img
            src={place.coverUrl}
            alt={place.name}
            width={CARD_IMAGE_WIDTH}
            height={CARD_IMAGE_HEIGHT}
            loading="lazy"
            decoding="async"
          />
        : <span className="place-hub-card-placeholder" aria-hidden="true" />}
      <strong>{place.name}</strong>
      {/* Category and neighbourhood come straight from the catalogue. Without them every card on
          every hub reads as a name over a city name, which is the shape of a page with nothing
          of its own to say. */}
      <small>
        {place.categoryLabel ? <span className="place-hub-card-kind">{place.categoryLabel}</span> : null}
        {place.area || place.city ? <span>{place.area || place.city}</span> : null}
      </small>
      {place.summary ? <p>{place.summary}</p> : null}
    </Link>
  </li>
}

function LinkSection({ title, links }) {
  if (!links?.length) return null
  return <section className="place-hub-section">
    <h2>{title}</h2>
    <ul className="place-hub-links">
      {links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}
    </ul>
  </section>
}


// Paging is rendered as plain anchors so a crawler walks past the first 24 places without
// running JavaScript. `hubPageHref` keeps page 1 on the bare path so it stays the canonical.
export function hubPageHref(basePath, page) {
  return page > 1 ? `${basePath}?page=${page}` : basePath
}

function Pagination({ basePath, page, totalPages }) {
  if (!basePath || !totalPages || totalPages < 2) return null
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
  return <nav className="place-hub-pagination" aria-label="Pagination">
    {page > 1
      ? <Link className="place-hub-pagination-step" rel="prev" href={hubPageHref(basePath, page - 1)}>← Previous</Link>
      : null}
    <ol>
      {pages.map((value) => <li key={value}>
        {value === page
          ? <span aria-current="page">{value}</span>
          : <Link href={hubPageHref(basePath, value)}>{value}</Link>}
      </li>)}
    </ol>
    {page < totalPages
      ? <Link className="place-hub-pagination-step" rel="next" href={hubPageHref(basePath, page + 1)}>Next →</Link>
      : null}
  </nav>
}

export function PlaceHub({ trail = [], title, intro, places = [], emptyNote, sections = [], pagination = null }) {
  return <>
    <PublicHeader />
    <main className="place-hub">
      <Breadcrumbs trail={trail} />
      <header className="place-hub-header">
        <h1>{title}</h1>
        {intro ? <p>{intro}</p> : null}
      </header>
      {places.length
        ? <ul className="place-hub-grid">{places.map((place) => <PlaceCard key={place.slug} place={place} />)}</ul>
        : emptyNote ? <p className="place-hub-empty">{emptyNote}</p> : null}
      {pagination ? <Pagination {...pagination} /> : null}
      {sections.map((section) => <LinkSection key={section.title} title={section.title} links={section.links} />)}
    </main>
  </>
}
