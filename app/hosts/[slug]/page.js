import { notFound } from 'next/navigation'
import { PublicHostView } from '@/components/public-listing'
import { getPublicHost } from '@/lib/app/public-content'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const { slug } = await params
  const result = await getPublicHost(slug)
  if (!result) return { title: 'Host not found' }
  return { title: result.host.name, description: result.host.description, alternates: { canonical: `/hosts/${result.host.slug}` }, openGraph: { title: result.host.name, description: result.host.description, url: `/hosts/${result.host.slug}`, images: [{ url: '/og-puddle.svg', width: 1200, height: 630, alt: result.host.name }] } }
}

export default async function HostPage({ params }) {
  const { slug } = await params
  const result = await getPublicHost(slug)
  if (!result) notFound()
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'
  const structured = { '@context': 'https://schema.org', '@type': 'Organization', name: result.host.name, description: result.host.description, url: `${site}/hosts/${result.host.slug}` }
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\u003c') }} /><PublicHostView {...result} /></>
}
