import { notFound } from 'next/navigation'
import { PublicLocationView } from '@/components/public-listing'
import { getPublicLocation, placeStructuredData } from '@/lib/app/public-content'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const { slug } = await params
  const result = await getPublicLocation(slug)
  if (!result) return { title: 'Place not found' }
  const { location } = result
  return {
    title: location.name,
    description: location.summary || location.description,
    alternates: { canonical: `/places/${location.slug}` },
    openGraph: { type: 'website', title: location.name, description: location.summary || location.description, url: `/places/${location.slug}`, images: [{ url: '/og-puddle.svg', width: 1200, height: 630, alt: location.name }] }
  }
}

export default async function PlacePage({ params }) {
  const { slug } = await params
  const result = await getPublicLocation(slug)
  if (!result) notFound()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const structured = placeStructuredData(result.location, `${site}/places/${result.location.slug}`)
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\u003c') }} /><PublicLocationView {...result} /></>
}
