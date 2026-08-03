import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateMatchWorkspaceRealtime } from '@/components/date-match-workspace-realtime'
import { EmptyState } from '@/components/empty-state'
import { getDateMatchSnapshotV2 } from '@/lib/app/date-match-snapshot'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Group Hangout Match',
  description: 'Let a group privately choose from the same location deck and reveal the strongest no-veto matches.'
}

export default async function HangoutMatchPage({ params }) {
  const { token } = await params
  return renderProductPage(async (session) => {
    const snapshot = await getDateMatchSnapshotV2(session, token)
    if (!snapshot) {
      return <EmptyState icon="♡♡♡" title="This Hangout Match is unavailable." description="The invitation may be invalid, expired, or the group may already be full." actionHref="/discover" actionLabel="Start a new group deck" />
    }

    if (snapshot.deck.mode !== 'hangout') redirect(`/date-match/${token}`)

    const memberCount = Number(snapshot.deck.memberCount || 0)
    const minimumReached = memberCount >= 3
    const remainingToStart = Math.max(0, 3 - memberCount)
    const openPlaces = Math.max(0, Number(snapshot.deck.maxMembers || 3) - memberCount)

    return <>
      <section className="date-swipe-heading date-match-heading is-hangout">
        <div>
          <span className="section-pill section-pill-mint">Group Hangout Match</span>
          <h1>Choose privately. Reveal where the group agrees.</h1>
          <p>{minimumReached
            ? `${memberCount} people are in. A location becomes a group match when at least 60% save it and nobody passes.`
            : `Invite ${remainingToStart} more ${remainingToStart === 1 ? 'person' : 'people'} to unlock group matching. Everyone can start choosing privately now.`}</p>
          <div className="hangout-heading-stats" aria-label="Hangout Match status">
            <span><strong>{memberCount}</strong> joined</span>
            <span><strong>{snapshot.deck.completedCount}</strong> finished</span>
            <span><strong>{openPlaces}</strong> open {openPlaces === 1 ? 'place' : 'places'}</span>
          </div>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡♡♡</span><strong>⇄</strong></div>
      </section>
      <DateMatchWorkspaceRealtime initialSnapshot={snapshot} />
      <p className="date-match-back-link"><Link href="/discover">← Return to your personal deck</Link></p>
    </>
  })
}
