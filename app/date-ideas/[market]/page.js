import { notFound } from 'next/navigation'
import { PlaceGroups, PlaceHub, marketLinks } from '@/components/place-hub'
import { DATE_MIN_INDEXABLE, dateIdeasPath, getDateIdeas } from '@/lib/app/date-ideas'
import { PLACE_CATEGORIES, listMarkets, marketPath, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData, placeListStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

function copy(market) {
  const region = marketRegionLabel(market)
  return {
    title: `Date ideas in ${market.name}`,
    description: `Coffee, dinner, drinks, walks, museums and things to do together in ${market.name}${region ? `, ${region}` : ''}. Real places, not a generic list.`
  }
}

// Leading with a direct, self-contained answer: it is what a featured snippet quotes, what an
// answer engine lifts, and what a reader wants before scrolling. The numbers come from the
// catalogue, so no two cities read the same.
function summarise(market, groups, total) {
  if (!total) return ''
  const named = groups.slice(0, 3).map((group) => group.title.toLowerCase())
  const list = named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
    : named[0]
  return `Puddle lists ${total} date spots in ${market.name}, grouped into ${groups.length} kinds of date including ${list}. Every one is a real place with its own page, address and nearby alternatives.`
}

export async function generateMetadata({ params }) {
  const { market: marketId } = await params
  const result = await getDateIdeas(marketId)
  if (!result) return { title: 'Date ideas not found' }
  const { market, groups, total } = result
  const { title, description } = copy(market)
  const canonical = dateIdeasPath(market)
  const base = {
    title,
    description: summarise(market, groups, total) || description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle' }]
    }
  }
  // Same floor the hubs use: a city with almost nothing to show has no page of its own to offer.
  return total >= DATE_MIN_INDEXABLE ? base : { ...base, robots: { index: false, follow: true } }
}

export default async function DateIdeasPage({ params }) {
  const { market: marketId } = await params
  const result = await getDateIdeas(marketId)
  if (!result) notFound()

  const { market, groups, total } = result
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market)
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Date ideas', href: '/date-ideas' },
    { label: market.name, href: dateIdeasPath(market) }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  const itemList = placeListStructuredData(groups.flatMap((group) => group.places), site, title)
  const otherMarkets = listMarkets().filter((entry) => entry.id !== market.id).slice(0, 12)

  return <>
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    {itemList ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(itemList) }} /> : null}
    <PlaceHub
      trail={trail}
      title={title}
      intro={[summarise(market, groups, total), description].filter(Boolean).join(' ')}
      emptyNote={`We are still mapping ${market.name}. Try another city below.`}
      sections={[
        { title: `Browse ${market.name} by category`, links: PLACE_CATEGORIES.map((category) => ({ href: marketPath(market, category), label: `${category.label} in ${market.name}` })) },
        { title: 'Date ideas in other cities', links: otherMarkets.map((entry) => ({ href: dateIdeasPath(entry), label: `Date ideas in ${entry.name}` })) },
        { title: 'All cities', links: marketLinks(listMarkets()) }
      ]}
      faq={total ? [
        {
          question: `What are good date ideas in ${market.name}?`,
          answer: `${summarise(market, groups, total)} The groups cover ${groups.map((group) => group.title.toLowerCase()).join(', ')}.`
        },
        {
          question: `Where can I find cheap date ideas in ${market.name}?`,
          answer: `Parks, scenic spots, museums and galleries cost little or nothing. Each place page lists a price level where the catalogue knows one, so you can see before you go.`
        },
        {
          question: 'How does Puddle pick these places?',
          answer: `They come from Puddle's place catalogue for ${market.name}, filtered to the kinds of places people actually pick for a date, and ordered so places with photos come first.`
        }
      ] : []}
    >
      <PlaceGroups groups={groups} />
    </PlaceHub>
  </>
}
