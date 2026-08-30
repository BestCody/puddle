import { PlaceHub, marketLinks } from '@/components/place-hub'
import { PLACE_CATEGORIES, listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

const title = 'Places to go, city by city'
const description = 'Browse parks, coffee shops, restaurants, museums, and nightlife across every city on Puddle. Find somewhere worth going, then see who else is there.'

export const metadata = {
  title,
  description,
  alternates: { canonical: '/places' },
  openGraph: {
    type: 'website',
    title,
    description,
    url: '/places',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle' }]
  }
}

// The landing page links here and this page links to every market hub, which is what gives
// crawlers a route into the per-place records served out of the B2 catalogue.
export default function PlacesIndexPage() {
  const markets = listMarkets()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)

  const byRegion = new Map()
  for (const market of markets) {
    const region = marketRegionLabel(market) || 'More cities'
    if (!byRegion.has(region)) byRegion.set(region, [])
    byRegion.get(region).push(market)
  }

  const sections = [...byRegion.entries()].map(([region, entries]) => ({
    title: region,
    links: marketLinks(entries)
  }))

  const flagship = markets[0]
  if (flagship) {
    sections.push({
      title: 'Browse by category',
      links: PLACE_CATEGORIES.map((category) => ({
        href: `/places/in/${flagship.id}/${category.slug}`,
        label: `${category.label} in ${flagship.name}`
      }))
    })
  }

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    <PlaceHub
      trail={trail}
      title="Find somewhere worth going."
      intro={description}
      sections={sections}
    />
  </>
}
