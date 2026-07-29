import Link from 'next/link'
import { notFound } from 'next/navigation'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getTicketDetail } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ticket' }

export default async function TicketPage({ params }) {
  const { id } = await params
  return renderProductPage(async (session) => {
    const ticket = await getTicketDetail(session, id)
    if (!ticket) notFound()
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Signed ticket</span><h1 className="product-title">{ticket.events?.title || 'Event ticket'}</h1><p>{ticket.ticket_types?.name} · {ticket.ticket_number}</p></div><Link className="quiet-button" href="/wallet">Back to wallet</Link></section><article className="ticket-detail-card"><img src={`/api/tickets/${ticket.id}/qr`} alt={`QR code for ticket ${ticket.ticket_number}`} /><div><span className={`finance-status ${ticket.status === 'valid' ? 'is-ready' : 'is-pending'}`}>{ticket.status.replaceAll('_',' ')}</span><h2>{ticket.events?.title}</h2><p>{ticket.events?.starts_at ? new Date(ticket.events.starts_at).toLocaleString('en-CA', { dateStyle:'full', timeStyle:'short', timeZone:ticket.events.timezone || undefined }) : ''}</p><p>{ticket.events?.locations?.name || ticket.events?.locations?.city || 'See event details for location.'}</p><small>Show this signed QR code at check-in. Screenshots work, but transfers and refunds invalidate older codes.</small></div></article></>
  })
}
