import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { AttendeeManager } from '@/components/attendee-manager'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Event attendees' }

export default async function EventAttendeesPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [{ data: event }, { data: attendees }] = await Promise.all([
      session.supabase.from('events').select('id,title,slug,capacity,approval_required,status').eq('id', id).maybeSingle(),
      session.supabase.from('event_rsvps').select('profile_id,status,visibility,guest_count,answers,waitlist_position,requested_at,approved_at,checked_in_at,profiles(display_name,username,avatar_path)').eq('event_id', id).order('created_at')
    ])
    if (!event) notFound()
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-yellow">Host tools</span><h1 className="product-title">{event.title} attendees.</h1><p>Approve requests, watch capacity, manage the waitlist, and check people in.</p></div><a className="text-link" href={`/studio/events/${event.id}`}>Back to editor →</a></div><AuthMessage searchParams={messages}/><AttendeeManager event={event} attendees={attendees || []}/></>
  })
}
