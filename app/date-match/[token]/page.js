import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateMatchWorkspaceRealtime } from '@/components/date-match-workspace-realtime'
import { EmptyState } from '@/components/empty-state'
import { getDateMatchSnapshotV2 } from '@/lib/app/date-match-snapshot'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'DateMatch',
  description: 'Privately swipe the same location deck and reveal the places that both people independently choose.'
}

export default async function DateMatchPage({ params }) {
  const { token } = await params
  return renderProductPage(async (session) => {
    const snapshot = await getDateMatchSnapshotV2(session, token)
    if (!snapshot) {
      return <EmptyState icon="♡" title="This shared deck is unavailable." description="The invitation may be invalid, expired, or already full." actionHref="/discover" actionLabel="Start a new location deck" />
    }

    if (snapshot.deck.mode === 'hangout') redirect(`/hangout/${token}`)

    const enoughPeople = snapshot.deck.memberCount >= 2
    return <>
      <section className="date-swipe-heading date-match-heading">
        <div>
          <span className="section-pill">DateMatch</span>
          <h1>Choose privately. Match on the locations you both want.</h1>
          <p>{enoughPeople ? 'You are both in. Your choices stay private until you independently save the same place.' : 'Your deck is ready. Share the invitation link while you start choosing your favourites.'}</p>
        </div>
        <div className="date-swipe-heading-mark" aria-hidden="true"><span>♡</span><strong>⇄</strong></div>
      </section>
      <DateMatchWorkspaceRealtime initialSnapshot={snapshot} />
      <p className="date-match-back-link"><Link href="/discover">← Return to your personal deck</Link></p>
    </>
  })
}
