import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PublicEventView } from '@/components/public-listing'
import { ListingSocial } from '@/components/listing-social'
import { TemporaryLocationSharing } from '@/components/temporary-location-sharing'
import { TicketPurchasePanel } from '@/components/ticket-purchase-panel'
import { eventStructuredData, getPublicEvent } from '@/lib/app/public-content'
import { getPublicTicketOffer } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }) { const { slug }=await params;const result=await getPublicEvent(slug);if(!result)return{title:'Event not found'};const{event}=result;return{title:event.title,description:event.summary||event.description,alternates:{canonical:`/events/${event.slug}`},openGraph:{type:'website',title:event.title,description:event.summary||event.description,url:`/events/${event.slug}`,images:[{url:event.cover_url||'/events/neon-night.svg',width:1200,height:630,alt:event.title}]}} }
export default async function EventPage({params}){const{slug}=await params;const result=await getPublicEvent(slug);if(!result)notFound();const tiers=await getPublicTicketOffer(result.event.id);const site=process.env.NEXT_PUBLIC_SITE_URL||'https://puddle.you';const structured=eventStructuredData(result.event,`${site}/events/${result.event.slug}`);const returnTo=`/events/${result.event.slug}`;const nonce=(await headers()).get('x-nonce')||undefined;return <><script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,'\u003c')}}/><PublicEventView {...result}/><TicketPurchasePanel eventId={result.event.id} eventSlug={result.event.slug} tiers={tiers}/><TemporaryLocationSharing contextKind="event" contextId={result.event.id} contextLabel={result.event.title}/><ListingSocial kind="event" content={result.event} returnTo={returnTo}/></>}
