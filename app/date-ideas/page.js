import { PlaceHub, marketLinks } from '@/components/place-hub'
import { DATE_GROUPS, dateIdeasPath } from '@/lib/app/date-ideas'
import { listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

// This page lists the markets, which only change when the site is deployed, so an hourly
// refresh spent a function invocation and a cache write on identical output twenty-four times
// a day.
export const revalidate = 86400

const title = 'Date ideas, city by city'
const description = 'Coffee, dinner, drinks, walks, museums and things to do together - drawn from real places rather than a generic list. Pick a city to see what is near you.'

export const metadata = {
  title,
  description,
  alternates: { canonical: '/date-ideas' },
  openGraph: {
    type: 'website',
    title,
    description,
    url: '/date-ideas',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle' }]
  }
}

// The city pages are the ones meant to rank; this exists so they are one click from the site
// rather than reachable only through a sitemap, and so the set has an obvious home.
export default function DateIdeasIndexPage() {
  const markets = listMarkets()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Date ideas', href: '/date-ideas' }
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
    links: entries.map((market) => ({ href: dateIdeasPath(market), label: `Date ideas in ${market.name}` }))
  }))

  sections.push({
    title: 'Or browse every place by city',
    links: marketLinks(markets)
  })

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    <PlaceHub
      trail={trail}
      title="Date ideas, city by city."
      intro={`${description} Every city page groups places into ${DATE_GROUPS.length} kinds of date: ${DATE_GROUPS.map((group) => group.title.toLowerCase()).join(', ')}.`}
      sections={sections}
      faq={[
        {
          question: 'What makes these different from a list of date ideas?',
          answer: 'Each suggestion is a real place with its own page, address, opening hours where known, and nearby alternatives - not a generic prompt like "go for a picnic".'
        },
        {
          question: 'Which cities are covered?',
          answer: `${markets.length} metropolitan areas across Canada and the United States, listed above.`
        }
      ]}
    />
  </>
}
