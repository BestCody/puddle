import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { requestEventAttendance } from '@/app/plans/actions'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Join event' }

export default async function JoinEventPage({ params, searchParams }) {
  const { slug } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const { data: event } = await session.supabase.from('events')
      .select('id,title,slug,summary,starts_at,ends_at,capacity,min_age,approval_required,attendee_questions,status,locations(name,city)')
      .eq('slug', slug).eq('status', 'published').maybeSingle()
    if (!event) notFound()
    const { data: existing } = await session.supabase.from('event_rsvps').select('status,visibility,guest_count,waitlist_position').eq('profile_id', session.user.id).eq('event_id', event.id).maybeSingle()
    return (
      <>
        <section className="product-hero product-hero-pink"><div><span className="section-pill">Join the plan</span><h1>{event.title}</h1><p>{event.summary || 'Confirm your attendance and choose what other attendees can see.'}</p><div className="public-meta-row"><span>{new Date(event.starts_at).toLocaleString('en-CA',{weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})}</span><span>{event.locations?.name || event.locations?.city || 'Location in event details'}</span><span>{event.approval_required ? 'Host approval required' : 'Instant confirmation when space is available'}</span></div></div></section>
        <AuthMessage searchParams={messages} />
        {existing ? <section className="rsvp-current"><span className="section-pill section-pill-yellow">Current RSVP</span><h2>{existing.status.replaceAll('_',' ')}</h2>{existing.status==='waitlisted'?<p>Waitlist position {existing.waitlist_position || 'pending'}.</p>:null}</section> : null}
        <form className="rsvp-form" action={requestEventAttendance}>
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="slug" value={event.slug} />
          <label>Guests<select name="guest_count" defaultValue={existing?.guest_count || 1}>{[1,2,3,4,5].map((count)=><option key={count} value={count}>{count}</option>)}</select></label>
          <label>Who can see that you are going?<select name="visibility" defaultValue={existing?.visibility || 'hidden'}><option value="hidden">Nobody</option><option value="friends">Friends</option><option value="attendees">Confirmed attendees</option><option value="public">Everyone</option></select></label>
          {(event.attendee_questions || []).length ? (event.attendee_questions || []).map((item,index)=><label className="span-two" key={index}>{item.question || item}<textarea name={`answer_${index}`} required={Boolean(item.required)} /></label>) : <label className="span-two">Anything the host should know?<textarea name="answer_note" /></label>}
          <button className="splash-button splash-button-mint" type="submit">{event.approval_required ? 'Request to join' : 'Confirm attendance'}</button>
        </form>
      </>
    )
  })
}
