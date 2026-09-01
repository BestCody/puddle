import { notFound } from 'next/navigation'
import { PlaceHub, categoryLinks, hubPageHref, marketLinks } from '@/components/place-hub'
import {
  PLACE_CATEGORIES,
  describeHubPlaces,
  HUB_MIN_INDEXABLE,
  getCachedMarketPlaces,
  getCategory,
  getMarket,
  listMarkets,
  marketRegionLabel,
  paginateHubPlaces
} from '@/lib/app/seo-places'
import { breadcrumbStructuredData, placeListStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

// Each revalidation costs a function invocation, a catalogue read and a runtime cache write,
// and this page follows a catalogue that rebuilds once a day. Six hours keeps the page within a
// quarter of a rebuild cycle while doing that work a sixth as often.
export const revalidate = 21600

function copy(market, category) {
  const region = marketRegionLabel(market)
  return {
    title: `${category.label} in ${market.name}`,
    description: `Find ${category.label.toLowerCase()} in ${market.name}${region ? `, ${region}` : ''}. Browse each ${category.singular}, save the ones you like, and see who else is going.`
  }
}

export async function generateMetadata({ params, searchParams }) {
  const { market: marketId, category: categorySlug } = await params
  const market = getMarket(marketId)
  const category = getCategory(categorySlug)
  if (!market || !category) return { title: 'Places not found' }
  const { title, description } = copy(market, category)
  const basePath = `/places/in/${market.id}/${category.slug}`
  // Same cached lookup the page body makes, so this costs nothing extra.
  const places = await getCachedMarketPlaces(market.id, category.slug)
  const { page, totalPages } = paginateHubPlaces(places, (await searchParams)?.page)
  // Later pages list different places, so each one canonicalises to itself and says which page
  // it is. Pointing them all at page 1 would keep everything past the first 24 out of the index.
  const suffix = page > 1 ? ` — page ${page} of ${totalPages}` : ''
  const base = {
    title: `${title}${suffix}`,
    // Counts describe the whole hub, not the current page, so the snippet does not claim a
    // city has 24 places when page 2 exists.
    description: describeHubPlaces(places, { market, category }) || description,
    alternates: { canonical: hubPageHref(basePath, page) },
    openGraph: {
      type: 'website',
      title: `${title}${suffix}`,
      description,
      url: hubPageHref(basePath, page),
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle' }]
    }
  }
  // A hub with nothing to list has no content of its own, only navigation. Keeping those out
  // of the index avoids a run of near-identical listing-free pages, and crawlers still follow
  // the city and category links. It reverses itself once the catalogue covers the combination.
  return places.length >= HUB_MIN_INDEXABLE ? base : { ...base, robots: { index: false, follow: true } }
}

export default async function MarketCategoryHubPage({ params, searchParams }) {
  const { market: marketId, category: categorySlug } = await params
  const market = getMarket(marketId)
  const category = getCategory(categorySlug)
  if (!market || !category) notFound()

  const places = await getCachedMarketPlaces(market.id, category.slug)
  const { items, page, totalPages } = paginateHubPlaces(places, (await searchParams)?.page)
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market, category)
  const basePath = `/places/in/${market.id}/${category.slug}`
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    { label: market.name, href: `/places/in/${market.id}` },
    { label: category.label, href: basePath }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  const itemList = placeListStructuredData(items, site, title)
  const siblings = PLACE_CATEGORIES.filter((entry) => entry.slug !== category.slug)
  const otherMarkets = listMarkets().filter((entry) => entry.id !== market.id).slice(0, 12)
  // Naming real places stops 400+ category hubs reading as one sentence with the nouns swapped.
  const intro = [description, describeHubPlaces(places, { market, category })].filter(Boolean).join(' ')

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    {itemList ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(itemList) }} /> : null}
    <PlaceHub
      trail={trail}
      title={page > 1 ? `${title} — page ${page}` : title}
      intro={intro}
      places={items}
      emptyNote={`We have not mapped ${category.label.toLowerCase()} in ${market.name} yet. Try another category below.`}
      pagination={{ basePath, page, totalPages }}
      sections={[
        { title: `More in ${market.name}`, links: categoryLinks(market, siblings) },
        { title: `${category.label} in other cities`, links: otherMarkets.map((entry) => ({ href: `/places/in/${entry.id}/${category.slug}`, label: `${category.label} in ${entry.name}` })) },
        { title: 'Browse all cities', links: marketLinks(listMarkets()) }
      ]}
    />
  </>
}
