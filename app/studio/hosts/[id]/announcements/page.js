import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { sendHostAnnouncement } from '@/app/social/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Host announcement' }

export default async function HostAnnouncementPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [{ data: allowed }, { data: host }, { data: events }] = await Promise.all([
      session.supabase.rpc('has_host_role', { target: id, allowed: ['owner','editor','moderator'] }),
      session.supabase.from('host_profiles').select('id,name,slug').eq('id', id).maybeSingle(),
      session.supabase.from('events').select('id,title,status').eq('host_profile_id', id).in('status', ['scheduled','published','postponed']).order('starts_at').limit(50)
    ])
    if (!allowed || !host) notFound()
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Host followers</span><h1 className="product-title">Send an announcement.</h1><p>Notify people who follow {host.name}. Use this for useful event and place updates, not general promotion.</p></div></section><AuthMessage searchParams={messages}/><form className="editor-card host-announcement-form" action={sendHostAnnouncement}><input type="hidden" name="host_id" value={host.id}/><input type="hidden" name="next" value={`/studio/hosts/${host.id}/announcements`}/><label className="editor-field">Related event<select name="event_id" defaultValue=""><option value="">General host update</option>{(events || []).map((event)=><option value={event.id} key={event.id}>{event.title} · {event.status}</option>)}</select></label><label className="editor-field">Title<input name="title" required minLength="2" maxLength="160" placeholder="Tonight's entrance has moved"/></label><label className="editor-field">Message<textarea name="body" required minLength="1" maxLength="1000" placeholder="Give followers the specific update they need."/></label><button className="splash-button splash-button-yellow" type="submit">Notify followers</button></form></>
  })
}
