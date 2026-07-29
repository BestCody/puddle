import Link from 'next/link'
import { TicketFinanceConsole } from '@/components/ticket-finance-console'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getEventFinanceDashboard } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ticketing and finance' }

export default async function EventFinancePage({ params }) {
  const { id } = await params
  return renderProductPage(async (session) => {
    const dashboard = await getEventFinanceDashboard(session, id)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Stage 5 finance</span><h1 className="product-title">{dashboard.event?.title || 'Event ticketing'}</h1><p>Inventory, orders, refunds, disputes, payouts, and the ledger stay attached to this event.</p></div><Link className="quiet-button" href={`/studio/events/${id}`}>Back to event studio</Link></section><TicketFinanceConsole eventId={id} initialDashboard={dashboard}/></>
  })
}
