import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

function escapeIcs(value) {
  return String(value || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
}

function stamp(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
}

export async function GET(_request, context) {
  if (!isSupabaseConfigured()) return new Response('Calendar unavailable', { status: 503 })
  const { id } = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in required', { status: 401 })

  const { data: plan } = await supabase.from('plans').select('id,title,description,starts_at,ends_at,meeting_label').eq('id', id).maybeSingle()
  if (!plan) return new Response('Plan not found', { status: 404 })
  const { data: stops } = await supabase.from('plan_stops').select('id,planned_for,duration_minutes,note,events(title,starts_at,ends_at),locations(name,address_public)').eq('plan_id', id).order('position')

  const events = []
  for (const stop of stops || []) {
    const start = stop.events?.starts_at || stop.planned_for
    if (!start) continue
    const end = stop.events?.ends_at || new Date(new Date(start).getTime() + (stop.duration_minutes || 60) * 60000).toISOString()
    events.push([
      'BEGIN:VEVENT',
      `UID:${stop.id}@puddle.you`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escapeIcs(stop.events?.title || stop.locations?.name || plan.title)}`,
      `DESCRIPTION:${escapeIcs(stop.note || plan.description || '')}`,
      stop.locations?.address_public ? `LOCATION:${escapeIcs(stop.locations.address_public)}` : null,
      'END:VEVENT'
    ].filter(Boolean).join('\r\n'))
  }

  if (!events.length && plan.starts_at) {
    events.push(['BEGIN:VEVENT',`UID:${plan.id}@puddle.you`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(plan.starts_at)}`,`DTEND:${stamp(plan.ends_at || new Date(new Date(plan.starts_at).getTime()+7200000))}`,`SUMMARY:${escapeIcs(plan.title)}`,`DESCRIPTION:${escapeIcs(plan.description || '')}`,plan.meeting_label?`LOCATION:${escapeIcs(plan.meeting_label)}`:null,'END:VEVENT'].filter(Boolean).join('\r\n'))
  }

  const body = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Puddle//Shared Plans//EN','CALSCALE:GREGORIAN',...events,'END:VCALENDAR'].join('\r\n')
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="puddle-${plan.id}.ics"` } })
}
