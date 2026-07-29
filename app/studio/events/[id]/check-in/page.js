import Link from 'next/link'
import { CheckInScanner } from '@/components/check-in-scanner'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCheckinDashboard } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Check-in scanner' }

export default async function CheckinPage({ params }) {
  const { id } = await params
  return renderProductPage(async (session) => {
    const dashboard = await getCheckinDashboard(session, id)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-mint">Door operations</span><h1 className="product-title">{dashboard.event?.title || 'Check-in scanner'}</h1><p>Camera scans, signed-token verification, offline queueing, synchronization, duplicate warnings, and reversals.</p></div><Link className="quiet-button" href={`/studio/events/${id}/finance`}>Finance dashboard</Link></section><CheckInScanner eventId={id} publicKeyBase64={process.env.TICKET_SIGNING_PUBLIC_KEY_BASE64 || ''} initialDashboard={dashboard}/></>
  })
}
