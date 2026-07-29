import { notFound } from 'next/navigation'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getConversationDetail } from '@/lib/app/social-data'
import { RealtimeConversation } from '@/components/realtime-conversation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conversation' }

export default async function ConversationPage({ params }) {
  const { id } = await params
  return renderProductPage(async (session) => {
    const detail = await getConversationDetail(session, id)
    if (!detail) notFound()
    return <RealtimeConversation conversation={detail.conversation} membership={detail.membership} members={detail.members} initialMessages={detail.messages} currentUserId={detail.currentUserId}/>
  })
}
