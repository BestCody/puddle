import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inbox' }

export default async function InboxPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return (
      <>
        <section className="page-heading-row"><div><span className="section-pill">Plan chatter</span><h1 className="product-title">Inbox.</h1><p>Friend conversations, shared-plan chats, event rooms, and host updates will live together here.</p></div><span className="inbox-bubble">{snapshot.conversationCount}</span></section>
        <div className="inbox-layout"><aside className="conversation-list"><button className="is-active"><strong>All conversations</strong><span>{snapshot.conversationCount}</span></button><button><strong>Friends</strong><span>0</span></button><button><strong>Plans</strong><span>0</span></button><button><strong>Events</strong><span>0</span></button></aside><EmptyState icon="✉" title="Quiet for now." description="Messages appear after you connect with friends, join a plan, or participate in an event conversation." actionHref="/friends" actionLabel="Open Friends" /></div>
      </>
    )
  })
}
