import { approveEventAttendance, checkInAttendee, promoteEventWaitlist } from '@/app/plans/actions'

function answerSummary(answers) {
  const values = Object.values(answers || {}).map((item)=>String(item)).filter(Boolean)
  return values.length ? values.join(' · ') : 'No attendee note'
}

export function AttendeeManager({ event, attendees }) {
  const confirmed = attendees.filter((item)=>['going','checked_in'].includes(item.status)).reduce((sum,item)=>sum+(item.guest_count||1),0)
  return (
    <div className="attendee-manager">
      <section className="attendee-summary"><div><strong>{confirmed}</strong><span>confirmed guests</span></div><div><strong>{attendees.filter((item)=>item.status==='requested').length}</strong><span>requests</span></div><div><strong>{attendees.filter((item)=>item.status==='waitlisted').length}</strong><span>waitlisted</span></div><div><strong>{attendees.filter((item)=>item.status==='checked_in').length}</strong><span>checked in</span></div></section>
      <div className="attendee-capacity-bar"><strong>{event.capacity ? `${Math.max(0,event.capacity-confirmed)} spots left` : 'Open capacity'}</strong><form action={promoteEventWaitlist}><input type="hidden" name="event_id" value={event.id}/><button type="submit">Promote next eligible</button></form></div><section className="attendee-table">
        <div className="attendee-row attendee-head"><span>Person</span><span>Status</span><span>Guests</span><span>Visibility</span><span>Actions</span></div>
        {attendees.map((item)=><div className="attendee-row" key={item.profile_id}>
          <span><strong>{item.profiles?.display_name || `@${item.profiles?.username || 'member'}`}</strong><small>{answerSummary(item.answers)}</small></span>
          <span>{item.status.replaceAll('_',' ')}{item.waitlist_position?<small>#{item.waitlist_position}</small>:null}</span>
          <span>{item.guest_count || 1}</span>
          <span>{item.visibility}</span>
          <span className="attendee-actions">
            {item.status==='requested'?<><form action={approveEventAttendance}><input type="hidden" name="event_id" value={event.id}/><input type="hidden" name="attendee_id" value={item.profile_id}/><button name="decision" value="approve" type="submit">Approve</button></form><form action={approveEventAttendance}><input type="hidden" name="event_id" value={event.id}/><input type="hidden" name="attendee_id" value={item.profile_id}/><button name="decision" value="decline" type="submit">Decline</button></form></>:null}
            {item.status==='going'?<form action={checkInAttendee}><input type="hidden" name="event_id" value={event.id}/><input type="hidden" name="attendee_id" value={item.profile_id}/><button type="submit">Check in</button></form>:null}
            {item.status==='checked_in'?<span>✓ Checked in</span>:null}
          </span>
        </div>)}
      </section>
    </div>
  )
}
