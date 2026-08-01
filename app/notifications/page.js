import Link from 'next/link'
import { NotificationCenter } from '@/components/notification-center'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getNotificationSnapshot } from '@/lib/app/notifications-data'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Notifications',
  description: 'See group joins, shared matches, plans, reminders, and feedback prompts.'
}

export default async function NotificationsPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getNotificationSnapshot(session)
    return <div className="notifications-page">
      <section className="page-heading-row notifications-heading">
        <div><span className="section-pill">Puddle activity</span><h1 className="product-title">Only the updates that move a plan forward.</h1><p>Group joins, shared location matches, scheduled plans, reminders, and feedback live here—without rebuilding a general social inbox.</p></div>
        <div><Link className="splash-button splash-button-mint" href="/map">Open map</Link><Link className="splash-button splash-button-pink" href="/discover">Start a shared deck</Link></div>
      </section>
      <NotificationCenter initialSnapshot={snapshot} />
    </div>
  })
}
