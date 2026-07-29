import { notFound } from 'next/navigation'
import { PublicEventView } from '@/components/public-listing'
import { eventStructuredData, getPublicEvent } from '@/lib/app/public-content'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const { slug } = await params
  const result = await getPublicEvent(slug)
  if (!result) return { title: 'Event not found' }
  const { event } = result
  return {
    title: event.title,
    description: event.summary || event.description,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: { type: 'website', title: event.title, description: event.summary || event.description, url: `/events/${event.slug}`, images: [{ url: '/events/neon-night.svg', width: 1200, height: 630, alt: event.title }] }
  }
}

export default async function EventPage({ params }) {
  const { slug } = await params
  const result = await getPublicEvent(slug)
  if (!result) notFound()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const structured = eventStructuredData(result.event, `${site}/events/${result.event.slug}`)
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\u003c') }} /><PublicEventView {...result} /></>
}
