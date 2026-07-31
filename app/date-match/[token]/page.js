import Link from 'next/link'
import { DateMatchWorkspace } from '@/components/date-match-workspace'
import { EmptyState } from '@/components/empty-state'
import { getDateMatchSnapshot } from '@/lib/app/date-match'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'DateMatch',
  description: 'Swipe privately on the same date ideas and celebrate the places you both choose.'
}

export default async function DateMatchPage({ params }) {
  const { token } = await params
  return renderProductPage(async (session) => {
    const snapshot = await getDateMatchSnapshot(session, token)
    if (!snapshot) {
      return <EmptyState icon="♡" title="This DateMatch is unavailable." description="The invitation may be invalid, expired, or already full." actionHref="/discover" actionLabel="Start a new date deck" />
    }

    return <>
      <section className="date-swipe-heading date-match-heading">
        <div>
          <span className="section-pill">Swipe together</span>
          <h1>Choose privately. Match on the dates you both want.</h1>
          <p>{snapshot.deck.partnerJoined ? 'You are both in. Your choices stay private until you independently save the same place.' : 'Your deck is ready. Share the invitation link while you start choosing your favourites.'}</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡</span><strong>⇄</strong></div>
      </section>
      <DateMatchWorkspace initialSnapshot={snapshot} googleMapsBrowserKey={process.env.GOOGLE_MAPS_BROWSER_KEY || ''} />
      <p className="date-match-back-link"><Link href="/discover">← Return to your personal deck</Link></p>
    </>
  })
}
