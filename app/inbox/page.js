import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getInboxSnapshot } from '@/lib/app/social-data'
import { openSupportConversation } from '@/app/social/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inbox' }

export default async function InboxPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const data = await getInboxSnapshot(session)
    return <><section className="page-heading-row"><div><span className="section-pill">Plan chatter</span><h1 className="product-title">Inbox.</h1><p>Friends, shared plans, event rooms, host help, and Puddle support live together.</p></div><div className="inbox-heading-actions"><span className="inbox-bubble">{data.unreadCount}</span><form action={openSupportConversation}><input type="hidden" name="next" value="/inbox"/><button className="splash-button splash-button-yellow" type="submit">Contact support</button></form></div></section><AuthMessage searchParams={params}/>
      {data.conversations.length ? <section className="inbox-conversation-grid">{data.conversations.map((conversation)=><Link className={`inbox-conversation-card ${conversation.unread?'is-unread':''}`} href={`/inbox/${conversation.id}`} key={conversation.id}><div className="inbox-conversation-symbol">{conversation.kind==='direct'?'☺':conversation.kind==='event_room'?'✦':conversation.kind==='plan_room'?'◎':'?'}</div><div><span>{conversation.subtitle}</span><h2>{conversation.title}</h2><p>{conversation.lastMessage?.body || 'Start the conversation.'}</p><small>{conversation.lastMessage?.created_at ? new Date(conversation.lastMessage.created_at).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'No messages yet'}{conversation.membership.muted_until ? ' · muted':''}</small></div>{conversation.unread ? <i>new</i> : null}</Link>)}</section> : <EmptyState icon="✉" title="Quiet for now." description="Message a friend, join an event chat, or open a shared-plan chat." actionHref="/friends" actionLabel="Open Friends"/>}
    </>
  })
}
