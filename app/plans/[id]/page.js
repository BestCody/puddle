import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { addPlanAvailability, addPlanStop, createPlanPoll, invitePlanMember, postPlanMessage, respondToPlanInvitation, voteInPlanPoll } from '@/app/plans/actions'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPlanDetail } from '@/lib/app/plans-data'

export const dynamic = 'force-dynamic'

function StopCard({ stop, index }) {
  const event = stop.events
  const place = stop.locations
  return <article className="itinerary-stop"><span>{String(index + 1).padStart(2,'0')}</span><div><strong>{event?.title || place?.name || 'Plan stop'}</strong><p>{stop.note || event?.summary || place?.summary || 'Add a note for the group.'}</p><small>{stop.planned_for ? new Date(stop.planned_for).toLocaleString('en-CA', { month:'short',day:'numeric',hour:'numeric',minute:'2-digit' }) : 'Time not fixed'} · {event ? 'Event' : 'Place'}</small></div></article>
}

function PollCard({ poll, planId }) {
  return <article className="plan-poll-card"><span className="section-pill">{poll.status}</span><h3>{poll.question}</h3><div className="poll-options">{(poll.plan_poll_options || []).map((option) => {
    const yes = (option.plan_votes || []).filter((vote) => vote.choice === 'yes').length
    const maybe = (option.plan_votes || []).filter((vote) => vote.choice === 'maybe').length
    return <div key={option.id}><strong>{option.label || option.events?.title || option.locations?.name || 'Option'}</strong><span>{yes} yes · {maybe} maybe</span><form action={voteInPlanPoll}><input type="hidden" name="plan_id" value={planId} /><input type="hidden" name="option_id" value={option.id} /><button name="choice" value="yes" type="submit">Yes</button><button name="choice" value="maybe" type="submit">Maybe</button><button name="choice" value="no" type="submit">No</button></form></div>
  })}</div></article>
}

function InvitationCard({ planId }) {
  return <section className="plan-invitation-card"><span className="section-pill section-pill-yellow">Invitation</span><h2>Join this shared plan?</h2><p>Accept to see the itinerary, vote, add availability, and use the plan chat.</p><div><form action={respondToPlanInvitation}><input type="hidden" name="plan_id" value={planId}/><button name="response" value="accepted" type="submit">Join plan</button></form><form action={respondToPlanInvitation}><input type="hidden" name="plan_id" value={planId}/><button name="response" value="declined" type="submit">Decline</button></form></div></section>
}

export default async function PlanDetailPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const detail = await getPlanDetail(session, id)
    if (!detail) notFound()
    const { plan, members, availability, stops, polls, messages: chat, events, locations } = detail
    const membership = members.find((member) => member.profile_id === session.user.id)
    const accepted = membership?.status === 'accepted'
    const canEdit = accepted && ['owner','editor'].includes(membership.role)
    return (
      <>
        <section className="product-hero product-hero-purple"><div><span className="section-pill section-pill-yellow">Shared plan</span><h1>{plan.title}</h1><p>{plan.description || 'Build the day together.'}</p><div className="public-meta-row"><span>{plan.city || 'City flexible'}</span><span>{plan.status}</span><span>{members.filter((member)=>member.status==='accepted').length} people</span></div></div><div className="create-scribble" aria-hidden="true">vote<br/>plan<br/>go ↗</div></section>
        <AuthMessage searchParams={messages} />
        {!accepted ? <InvitationCard planId={plan.id} /> : <div className="plan-detail-grid">
          <main className="plan-detail-main">
            <section className="plan-section"><div className="plan-section-heading"><div><span className="section-pill section-pill-mint">Itinerary</span><h2>Stops in order.</h2></div><a className="text-link" href={`/plans/${plan.id}/calendar`}>Export calendar →</a></div>{stops.length ? <div className="itinerary-list">{stops.map((stop,index)=><StopCard stop={stop} index={index} key={stop.id} />)}</div> : <p className="empty-inline">No stops yet. Add a published event or place below.</p>}
            {canEdit ? <div className="plan-stop-builders"><form className="plan-inline-form" action={addPlanStop}><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="kind" value="event"/><label>Event<select name="target_id" required defaultValue=""><option value="" disabled>Choose an event</option>{events.map((event)=><option value={event.id} key={event.id}>{event.title}</option>)}</select></label><label>Time<input name="planned_for" type="datetime-local" /></label><label>Note<input name="note" placeholder="Meet by the front entrance" /></label><button type="submit">Add event</button></form><form className="plan-inline-form" action={addPlanStop}><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="kind" value="place"/><label>Place<select name="target_id" required defaultValue=""><option value="" disabled>Choose a place</option>{locations.map((place)=><option value={place.id} key={place.id}>{place.name} · {place.city}</option>)}</select></label><label>Time<input name="planned_for" type="datetime-local" /></label><label>Note<input name="note" placeholder="Grab a table near the window" /></label><button type="submit">Add place</button></form></div> : null}</section>

            <section className="plan-section"><div className="plan-section-heading"><div><span className="section-pill section-pill-yellow">Polls</span><h2>Decide together.</h2></div></div>{polls.length ? <div className="poll-grid">{polls.map((poll)=><PollCard poll={poll} planId={plan.id} key={poll.id} />)}</div> : <p className="empty-inline">No polls yet.</p>}{canEdit ? <form className="plan-inline-form vertical" action={createPlanPoll}><input type="hidden" name="plan_id" value={plan.id} /><label>Question<input name="question" required placeholder="Where should we start?" /></label><div className="plan-option-picker"><strong>Events and places</strong>{events.slice(0,10).map((event)=><label key={event.id}><input type="checkbox" name="candidate" value={`event:${event.id}`}/> {event.title}</label>)}{locations.slice(0,10).map((place)=><label key={place.id}><input type="checkbox" name="candidate" value={`place:${place.id}`}/> {place.name}</label>)}</div><label>Optional custom choices<textarea name="options" placeholder={'Picnic first\nDinner after'} /></label><label>Close voting<input name="closes_at" type="datetime-local" /></label><button type="submit">Open poll</button></form> : null}</section>

            <section className="plan-section" id="chat"><div className="plan-section-heading"><div><span className="section-pill">Plan chat</span><h2>Keep logistics together.</h2></div></div><div className="plan-chat">{chat.length ? chat.map((message)=><article key={message.id}><strong>{message.profiles?.display_name || message.profiles?.username || 'Puddle friend'}</strong><p>{message.body}</p><small>{new Date(message.created_at).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></article>) : <p className="empty-inline">No messages yet.</p>}</div><form className="plan-message-form" action={postPlanMessage}><input type="hidden" name="plan_id" value={plan.id} /><input name="body" required maxLength="2000" placeholder="Who is bringing snacks?" /><button type="submit">Send</button></form></section>
          </main>

          <aside className="plan-detail-sidebar">
            <section className="plan-side-card"><span className="section-pill section-pill-yellow">People</span><h2>{members.length} invited.</h2><div className="member-list">{members.map((member)=><div key={member.profile_id}><strong>{member.profiles?.display_name || `@${member.profiles?.username}`}</strong><span>{member.role} · {member.status}</span></div>)}</div>{canEdit ? <form className="vertical-form" action={invitePlanMember}><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="next" value={`/plans/${plan.id}`} /><label>Invite by username<input name="username" required placeholder="@friend" /></label><button type="submit">Invite</button></form> : null}</section>
            <section className="plan-side-card"><span className="section-pill section-pill-mint">Availability</span><h2>When works?</h2>{availability.map((slot)=><div className="availability-slot" key={slot.id}><strong>{slot.profiles?.display_name || slot.profiles?.username}</strong><span>{new Date(slot.starts_at).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric'})}–{new Date(slot.ends_at).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'})}</span></div>)}<form className="vertical-form" action={addPlanAvailability}><input type="hidden" name="plan_id" value={plan.id} /><label>Available from<input name="starts_at" type="datetime-local" required /></label><label>Until<input name="ends_at" type="datetime-local" required /></label><label>Note<input name="note" /></label><button type="submit">Add availability</button></form></section>
          </aside>
        </div>}
      </>
    )
  })
}
