import { notFound } from 'next/navigation'
import { PlaceGroups, PlaceHub, marketLinks } from '@/components/place-hub'
import { HANGOUT_MIN_INDEXABLE, getHangoutSpots, hangoutIsDistinct, hangoutPath } from '@/lib/app/hangout-spots'
import { dateIdeasPath } from '@/lib/app/date-ideas'
import { PLACE_CATEGORIES, listMarkets, marketPath, marketRegionLabel } from '@/lib/app/seo-places'
import { breadcrumbStructuredData, placeListStructuredData } from '@/lib/app/public-content'
import { serializeStructuredData } from '@/lib/app/structured-data'

export const revalidate = 3600

function copy(market) {
  const region = marketRegionLabel(market)
  return {
    title: `Hangout spots in ${market.name}`,
    description: `Where to meet friends in ${market.name}${region ? `, ${region}` : ''} - things to do, places to sit, markets to wander, and somewhere to go when it turns into a night out.`
  }
}

// A direct answer first, built from the catalogue, so the lead differs city to city and reads as
// an answer rather than an introduction.
function summarise(market, groups, total) {
  if (!total) return ''
  const named = groups.slice(0, 3).map((group) => group.title.toLowerCase())
  const list = named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
    : named[0]
  return `Puddle lists ${total} places to hang out in ${market.name}, across ${groups.length} kinds of plan including ${list}. Each one is a real place with its own page, address and nearby alternatives.`
}

export async function generateMetadata({ params }) {
  const { market: marketId } = await params
  const result = await getHangoutSpots(marketId)
  if (!result) return { title: 'Hangout spots not found' }
  const { market, groups, total } = result
  const { title, description } = copy(market)
  const canonical = hangoutPath(market)
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
  // Thin pages and pages that duplicate the date page are both kept out of the index; the links
  // still work either way, so nothing in the crawl graph depends on this.
  const worthIndexing = total >= HANGOUT_MIN_INDEXABLE && await hangoutIsDistinct(market.id, groups)
  return worthIndexing ? base : { ...base, robots: { index: false, follow: true } }
}

export default async function HangoutSpotsPage({ params }) {
  const { market: marketId } = await params
  const result = await getHangoutSpots(marketId)
  if (!result) notFound()

  const { market, groups, total } = result
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const { title, description } = copy(market)
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Hangout spots', href: '/hangout-spots' },
    { label: market.name, href: hangoutPath(market) }
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
        { title: `More in ${market.name}`, links: [
          { href: marketPath(market), label: `Things to do in ${market.name}` },
          { href: dateIdeasPath(market), label: `Date ideas in ${market.name}` },
          ...PLACE_CATEGORIES.slice(0, 6).map((category) => ({ href: marketPath(market, category), label: `${category.label} in ${market.name}` }))
        ] },
        { title: 'Hangout spots in other cities', links: otherMarkets.map((entry) => ({ href: hangoutPath(entry), label: `Hangout spots in ${entry.name}` })) },
        { title: 'All cities', links: marketLinks(listMarkets()) }
      ]}
      faq={total ? [
        {
          question: `Where can I hang out with friends in ${market.name}?`,
          answer: `${summarise(market, groups, total)} The groups cover ${groups.map((group) => group.title.toLowerCase()).join(', ')}.`
        },
        {
          question: `What is there to do in ${market.name} without spending much?`,
          answer: 'Parks, scenic spots, markets and community spaces are free to walk into. Each place page shows its address and, where the catalogue knows them, opening hours.'
        },
        {
          question: `How is this different from date ideas in ${market.name}?`,
          answer: `Hangouts lean towards groups: things to do, markets to wander, community spaces. The date page leans towards two people - dinner, drinks and museums - and lists different places.`
        }
      ] : []}
    >
      <PlaceGroups groups={groups} />
    </PlaceHub>
  </>
}
