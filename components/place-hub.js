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
      {place.city ? <small>{place.city}</small> : null}
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

export function PlaceHub({ trail = [], title, intro, places = [], emptyNote, sections = [] }) {
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
      {sections.map((section) => <LinkSection key={section.title} title={section.title} links={section.links} />)}
    </main>
  </>
}
