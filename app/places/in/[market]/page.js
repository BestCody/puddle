import { notFound } from 'next/navigation'
import { PlaceHub, categoryLinks, hubPageHref, marketLinks } from '@/components/place-hub'
import {
  PLACE_CATEGORIES,
  describeHubPlaces,
  HUB_MIN_INDEXABLE,
  getCachedMarketPlaces,
  getMarket,
  listMarkets,
  marketRegionLabel,
  paginateHubPlaces
} from '@/lib/app/seo-places'
import { breadcrumbStructuredData, placeListStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

function copy(market) {
  const region = marketRegionLabel(market)
  return {
    title: `Things to do in ${market.name}`,
    description: `Parks, coffee shops, restaurants, museums and nightlife in ${market.name}${region ? `, ${region}` : ''}. Browse places worth going, then see who else is there.`
  }
}

export async function generateMetadata({ params, searchParams }) {
  const { market: marketId } = await params
  const market = getMarket(marketId)
  if (!market) return { title: 'City not found' }
  const { title, description } = copy(market)
  const basePath = `/places/in/${market.id}`
  // Same cached lookup the page body makes, so this costs nothing extra.
  const places = await getCachedMarketPlaces(market.id)
  const { page, totalPages, items } = paginateHubPlaces(places, (await searchParams)?.page)
  // Later pages list different places, so each one canonicalises to itself and says which page
  // it is. Pointing them all at page 1 would keep everything past the first 24 out of the index.
  const suffix = page > 1 ? ` — page ${page} of ${totalPages}` : ''
  const base = {
    title: `${title}${suffix}`,
    description: describeHubPlaces(items, { market }) || description,
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

export default async function MarketHubPage({ params, searchParams }) {
  const { market: marketId } = await params
  const market = getMarket(marketId)
  if (!market) notFound()

  const places = await getCachedMarketPlaces(market.id)
  const { items, page, totalPages } = paginateHubPlaces(places, (await searchParams)?.page)
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market)
  const basePath = `/places/in/${market.id}`
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    { label: market.name, href: basePath }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  const itemList = placeListStructuredData(items, site, title)
  const otherMarkets = listMarkets().filter((entry) => entry.id !== market.id).slice(0, 12)
  // Naming real places stops every city hub reading as the same sentence with the name swapped.
  const intro = [description, describeHubPlaces(places, { market })].filter(Boolean).join(' ')

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    {itemList ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(itemList) }} /> : null}
    <PlaceHub
      trail={trail}
      title={page > 1 ? `${title} — page ${page}` : title}
      intro={intro}
      places={items}
      emptyNote={`We are still mapping ${market.name}. Browse a category below, or try another city.`}
      pagination={{ basePath, page, totalPages }}
      sections={[
        { title: `Browse ${market.name} by category`, links: categoryLinks(market, PLACE_CATEGORIES) },
        { title: 'Other cities', links: marketLinks(otherMarkets) }
      ]}
    />
  </>
}
