import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Friends' }

export default async function FriendsPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return (
      <>
        <section className="page-heading-row"><div><span className="section-pill section-pill-mint">Make plans together</span><h1 className="product-title">Your people.</h1><p>Friends help you share events, places, and actual plans—not swipe through people.</p></div><button className="splash-button splash-button-mint" type="button">Find a friend</button></section>
        <section className="friend-stats"><article><strong>{snapshot.friendCount}</strong><span>friends</span></article><article><strong>{snapshot.pendingFriendCount}</strong><span>requests</span></article><article><strong>0</strong><span>shared plans</span></article></section>
        {snapshot.friendCount ? <section className="plan-summary-card"><h2>Your friend list is connected.</h2><p>Friend cards, invitations, and shared planning arrive with the social stage.</p></section> : <EmptyState icon="☺" title="Bring your people in." description="Search by username, share your profile link, and build plans together once the social system is connected." actionHref="/discover" actionLabel="Find something to share" />}
      </>
    )
  })
}
