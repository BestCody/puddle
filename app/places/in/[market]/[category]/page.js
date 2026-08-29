import { notFound } from 'next/navigation'
import { PlaceHub, categoryLinks, marketLinks } from '@/components/place-hub'
import { PLACE_CATEGORIES, getCachedMarketPlaces, getCategory, getMarket, listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData, placeListStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

function copy(market, category) {
  const region = marketRegionLabel(market)
  return {
    title: `${category.label} in ${market.name}`,
    description: `Find ${category.label.toLowerCase()} in ${market.name}${region ? `, ${region}` : ''}. Browse each ${category.singular}, save the ones you like, and see who else is going.`
  }
}

export async function generateMetadata({ params }) {
  const { market: marketId, category: categorySlug } = await params
  const market = getMarket(marketId)
  const category = getCategory(categorySlug)
  if (!market || !category) return { title: 'Places not found' }
  const { title, description } = copy(market, category)
  const canonical = `/places/in/${market.id}/${category.slug}`
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', title, description, url: canonical }
  }
}

export default async function MarketCategoryHubPage({ params }) {
  const { market: marketId, category: categorySlug } = await params
  const market = getMarket(marketId)
  const category = getCategory(categorySlug)
  if (!market || !category) notFound()

  const places = await getCachedMarketPlaces(market.id, category.slug)
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market, category)
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    { label: market.name, href: `/places/in/${market.id}` },
    { label: category.label, href: `/places/in/${market.id}/${category.slug}` }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  const itemList = placeListStructuredData(places, site, title)
  const siblings = PLACE_CATEGORIES.filter((entry) => entry.slug !== category.slug)
  const otherMarkets = listMarkets().filter((entry) => entry.id !== market.id).slice(0, 12)

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    {itemList ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(itemList) }} /> : null}
    <PlaceHub
      trail={trail}
      title={title}
      intro={description}
      places={places}
      emptyNote={`We have not mapped ${category.label.toLowerCase()} in ${market.name} yet. Try another category below.`}
      sections={[
        { title: `More in ${market.name}`, links: categoryLinks(market, siblings) },
        { title: `${category.label} in other cities`, links: otherMarkets.map((entry) => ({ href: `/places/in/${entry.id}/${category.slug}`, label: `${category.label} in ${entry.name}` })) },
        { title: 'Browse all cities', links: marketLinks(listMarkets()) }
      ]}
    />
  </>
}
