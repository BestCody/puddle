import { PlaceHub, marketLinks } from '@/components/place-hub'
import { PLACE_CATEGORIES, listMarkets, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData, faqStructuredData } from '@/lib/app/public-content'
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
  // The index was 144 words of navigation, which reads as thin to a crawler and gives an answer
  // engine nothing to quote. These are the questions the index is actually the answer to.
  const faq = [
    {
      question: 'What is Puddle?',
      answer: 'Puddle is a place-discovery app for finding somewhere worth going and seeing who else is there. You swipe through nearby parks, coffee shops, restaurants, museums and nightlife, save the places you like, and plan trips with friends.'
    },
    {
      question: 'Which cities does Puddle cover?',
      answer: `Puddle covers ${markets.length} metropolitan areas across Canada and the United States, including ${markets.slice(0, 4).map((market) => market.name).join(', ')}. Each city has its own page listing places by category.`
    },
    {
      question: 'What kinds of places can I browse?',
      answer: `Every city is broken down into ${PLACE_CATEGORIES.length} categories: ${PLACE_CATEGORIES.map((category) => category.label.toLowerCase()).join(', ')}.`
    },
    {
      question: 'Does Puddle cost anything?',
      answer: 'No. Browsing places, saving them and planning with friends are free, and you can read any place page without an account.'
    }
  ]
  const faqSchema = faqStructuredData(faq)

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
    // The date pages target a different question than the hubs and are the ones meant to rank for
  // it, so the index links across rather than leaving them reachable only from the footer.
  sections.push({
    title: 'Looking for a date?',
    links: markets.slice(0, 12).map((market) => ({ href: `/date-ideas/${market.id}`, label: `Date ideas in ${market.name}` }))
  })

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
    {faqSchema ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(faqSchema) }} /> : null}
    <PlaceHub
      trail={trail}
      title="Find somewhere worth going."
      intro={description}
      sections={sections}
      faq={faq}
    />
  </>
}
