import { notFound } from 'next/navigation'
import { PlaceHub, categoryLinks, marketLinks } from '@/components/place-hub'
import { PLACE_CATEGORIES, getCachedMarketPlaces, getMarket, listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
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

export async function generateMetadata({ params }) {
  const { market: marketId } = await params
  const market = getMarket(marketId)
  if (!market) return { title: 'City not found' }
  const { title, description } = copy(market)
  const canonical = `/places/in/${market.id}`
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', title, description, url: canonical }
  }
}

export default async function MarketHubPage({ params }) {
  const { market: marketId } = await params
  const market = getMarket(marketId)
  if (!market) notFound()

  const places = await getCachedMarketPlaces(market.id)
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market)
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    { label: market.name, href: `/places/in/${market.id}` }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  const itemList = placeListStructuredData(places, site, title)
  const otherMarkets = listMarkets().filter((entry) => entry.id !== market.id).slice(0, 12)

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    {itemList ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(itemList) }} /> : null}
    <PlaceHub
      trail={trail}
      title={title}
      intro={description}
      places={places}
      emptyNote={`We are still mapping ${market.name}. Browse a category below, or try another city.`}
      sections={[
        { title: `Browse ${market.name} by category`, links: categoryLinks(market, PLACE_CATEGORIES) },
        { title: 'Other cities', links: marketLinks(otherMarkets) }
      ]}
    />
  </>
}
