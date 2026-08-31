import { notFound } from 'next/navigation'
import { PublicLocationView } from '@/components/public-listing'
import { breadcrumbStructuredData, placeIsIndexable, placeStructuredData } from '@/lib/app/public-content'
import { getCachedPublicLocation, getCachedPublicLocationRecommendations } from '@/lib/app/public-location-cache'
import { findMarketForPoint, marketPath } from '@/lib/app/seo-places'
import { serializeStructuredData } from '@/lib/app/structured-data'

export async function generateMetadata({ params }) {
  const { slug } = await params
  const result = await getCachedPublicLocation(slug)
  if (!result) return { title: 'Place not found' }
  const { location } = result
  return {
    title: location.name,
    description: location.summary || location.description,
    alternates: { canonical: `/places/${location.slug}` },
    openGraph: {
      type: 'website',
      title: location.name,
      description: location.summary || location.description,
      url: `/places/${location.slug}`,
      images: [{ url: location.cover_url || '/og.png', width: 1200, height: 630, alt: location.name }]
    },
    // Places with nothing of their own stay crawlable but out of the index. See placeIsIndexable.
    ...(placeIsIndexable(location) ? {} : { robots: { index: false, follow: true } })
  }
}

export default async function PlacePage({ params }) {
  const { slug } = await params
  const result = await getCachedPublicLocation(slug)
  if (!result) notFound()
  // Without these a place page links to no other place, so a crawler that reaches one has
  // nowhere left to go. The lookup is cached alongside the location itself.
  const similar = await getCachedPublicLocationRecommendations(slug)
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const structured = placeStructuredData(result.location, `${site}/places/${result.location.slug}`)
  // The trail is rendered on the page as well as in the markup. Google asks that BreadcrumbList
  // describe a breadcrumb the reader can see, and this is also the only link back up: most of the
  // sitemap is place URLs now, so a crawler landing here would otherwise find three sibling
  // places and no route to the hubs.
  const market = findMarketForPoint(result.location.latitude, result.location.longitude)
  const trail = [
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    // Only when the place actually falls inside a launch market; otherwise the crumb would point
    // at a hub that does not list it.
    ...(market ? [{ label: market.name, href: marketPath(market) }] : []),
    { label: result.location.name, href: `/places/${result.location.slug}` }
  ]
  const breadcrumbs = breadcrumbStructuredData(trail, site)
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structured) }} />
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    <PublicLocationView {...result} similar={similar} trail={trail} />
  </>
}
