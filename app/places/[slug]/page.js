import { notFound } from 'next/navigation'
import { PublicLocationView } from '@/components/public-listing'
import { breadcrumbStructuredData, placeStructuredData } from '@/lib/app/public-content'
import { getCachedPublicLocation } from '@/lib/app/public-location-cache'
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
      images: [{ url: location.cover_url || '/og-puddle.svg', width: 1200, height: 630, alt: location.name }]
    }
  }
}

export default async function PlacePage({ params }) {
  const { slug } = await params
  const result = await getCachedPublicLocation(slug)
  if (!result) notFound()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const structured = placeStructuredData(result.location, `${site}/places/${result.location.slug}`)
  // Mirrors the hub trail so a place inherits the same "Puddle > Places > ..." crumb path
  // its market hub advertises, which is what search results render above the title.
  const breadcrumbs = breadcrumbStructuredData([
    { label: 'Puddle', href: '/' },
    { label: 'Places', href: '/places' },
    { label: result.location.name, href: `/places/${result.location.slug}` }
  ], site)
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structured) }} />
    {breadcrumbs ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(breadcrumbs) }} /> : null}
    <PublicLocationView {...result} />
  </>
}
