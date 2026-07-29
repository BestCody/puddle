import { getPublicEvent } from '@/lib/app/public-content'

function escapeIcs(value) { return String(value || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;') }
function stamp(value) { const date=new Date(value); return Number.isNaN(date.getTime())?null:date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z') }

export async function GET(_request, context) {
  const { slug } = await context.params
  const result = await getPublicEvent(slug)
  if (!result?.event) return new Response('Event not found', { status: 404 })
  const event = result.event
  const location = event.location?.address_public || event.address_public || event.location?.name || ''
  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Puddle//Events//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${event.id}@puddle.you`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(event.starts_at)}`,`DTEND:${stamp(event.ends_at)}`,`SUMMARY:${escapeIcs(event.title)}`,`DESCRIPTION:${escapeIcs(event.summary || event.description || '')}`,location?`LOCATION:${escapeIcs(location)}`:null,`URL:${escapeIcs(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you'}/events/${event.slug}`)}`,'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n')
  return new Response(body, { headers: { 'Content-Type':'text/calendar; charset=utf-8', 'Content-Disposition':`attachment; filename="puddle-${event.slug}.ics"` } })
}
