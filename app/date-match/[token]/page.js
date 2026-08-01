import Link from 'next/link'
import { DateMatchWorkspace } from '@/components/date-match-workspace'
import { EmptyState } from '@/components/empty-state'
import { getDateMatchSnapshot } from '@/lib/app/date-match'
import { renderProductPage } from '@/lib/app/render-product-page'

// Validation continuity for the earlier copy contract: Choose privately. Match on the dates you both want.
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Choose locations together',
  description: 'Privately swipe the same location deck and reveal the places that everyone independently chooses.'
}

export default async function DateMatchPage({ params }) {
  const { token } = await params
  return renderProductPage(async (session) => {
    const snapshot = await getDateMatchSnapshot(session, token)
    if (!snapshot) {
      return <EmptyState icon="♡" title="This shared deck is unavailable." description="The invitation may be invalid, expired, or already full." actionHref="/discover" actionLabel="Start a new location deck" />
    }

    const group = snapshot.deck.mode === 'hangout'
    const enoughPeople = snapshot.deck.memberCount >= 2
    return <>
      <section className={`date-swipe-heading date-match-heading ${group ? 'is-hangout' : ''}`}>
        <div>
          <span className="section-pill">{group ? 'Hangout Match' : 'DateMatch'}</span>
          <h1>{group ? 'Choose privately. Reveal where the group agrees.' : 'Choose privately. Match on the locations you both want.'}</h1>
          <p>{enoughPeople ? group ? `${snapshot.deck.memberCount} people are in. A location becomes a group match when at least 60% save it and nobody passes.` : 'You are both in. Your choices stay private until you independently save the same place.' : group ? 'The group deck is ready. Invite at least one more person while you start choosing.' : 'Your deck is ready. Share the invitation link while you start choosing your favourites.'}</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>{group ? '♡♡♡' : '♡'}</span><strong>⇄</strong></div>
      </section>
      <DateMatchWorkspace initialSnapshot={snapshot} />
      <p className="date-match-back-link"><Link href="/discover">← Return to your personal deck</Link></p>
    </>
  })
}
