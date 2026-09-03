import { FigmaMessagesRealtime } from '@/components/figma-messages-realtime'
import { FigmaSocialHub } from '@/components/figma-social-hub'
import { PassMessageSearch } from '@/components/pass-message-search'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getSocialHubSnapshot } from '@/lib/app/social-hub-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Friends' }

export default async function FriendsPage({ searchParams }) {
  const params = await searchParams
  const requested = params?.tab === 'friends' ? 'add' : params?.tab
  const tab = ['add', 'messages', 'shared'].includes(requested) ? requested : 'messages'
  const conversationId = typeof params?.conversation === 'string' ? params.conversation : null

  return renderProductPage(async (session) => {
    const snapshot = await getSocialHubSnapshot(session, conversationId, { tab })
    return <div className="figma-friends-pass-wrapper">
      {tab === 'add' ? <PassMessageSearch enabled={snapshot.passActive} /> : null}
      {tab === 'messages'
        ? <FigmaMessagesRealtime initialSnapshot={snapshot} conversationId={conversationId} />
        : <FigmaSocialHub initialSnapshot={snapshot} initialTab={tab} />}
    </div>
  })
}
