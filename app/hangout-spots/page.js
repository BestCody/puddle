import { PlaceHub, marketLinks } from '@/components/place-hub'
import { HANGOUT_GROUPS, hangoutPath } from '@/lib/app/hangout-spots'
import { listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

const title = 'Hangout spots, city by city'
const description = 'Where to meet friends without a plan - things to do, places to sit, markets to wander, and somewhere to go when it turns into a night out. Pick a city to see what is near you.'

export const metadata = {
  title,
  description,
  alternates: { canonical: '/hangout-spots' },
  openGraph: {
    type: 'website',
    title,
    description,
    url: '/hangout-spots',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle' }]
  }
}

export default function HangoutSpotsIndexPage() {
  const markets = listMarkets()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Hangout spots', href: '/hangout-spots' }
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
    links: entries.map((market) => ({ href: hangoutPath(market), label: `Hangout spots in ${market.name}` }))
  }))

  sections.push({ title: 'Or browse every place by city', links: marketLinks(markets) })

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    <PlaceHub
      trail={trail}
      title="Hangout spots, city by city."
      intro={`${description} Every city page groups places into ${HANGOUT_GROUPS.length} kinds of plan: ${HANGOUT_GROUPS.map((group) => group.title.toLowerCase()).join(', ')}.`}
      sections={sections}
      faq={[
        {
          question: 'What counts as a hangout spot?',
          answer: 'Somewhere a group can turn up without a reservation and work out the plan there - a park, a market, an arcade, a community space, or a coffee shop with room to sit.'
        },
        {
          question: 'Which cities are covered?',
          answer: `${markets.length} cities, towns and neighbourhoods across Canada and the United States, listed above.`
        }
      ]}
    />
  </>
}
