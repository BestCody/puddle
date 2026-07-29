import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { EventEditor } from '@/components/event-editor'
import { MediaUploader } from '@/components/media-uploader'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions, getEditableEvent } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit event' }

export default async function EditEventPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [event, options] = await Promise.all([getEditableEvent(session.supabase, id), getCreatorOptions(session)])
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-yellow">Event studio</span><h1 className="product-title">{event.title}</h1><p>Autosave, preview, revise, add secure artwork, manage attendees, and move through publication.</p></div><Link className="splash-button splash-button-yellow" href={`/studio/events/${event.id}/attendees`}>Manage attendees</Link></div><AuthMessage searchParams={messages} /><section className="studio-media-grid"><MediaUploader purpose="event_cover" targetId={event.id} /><MediaUploader purpose="event_gallery" targetId={event.id} multiple /></section><EventEditor event={event} {...options} /></>
  })
}
