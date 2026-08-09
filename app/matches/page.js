import { SocialHub } from '@/components/social-hub'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getSocialHubSnapshot } from '@/lib/app/social-hub-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Friends' }

export default async function FriendsPage({ searchParams }) {
  const params = await searchParams
  const tab = ['friends', 'messages', 'shared'].includes(params?.tab) ? params.tab : 'friends'
  const conversationId = typeof params?.conversation === 'string' ? params.conversation : null

  return renderProductPage(async (session) => {
    const snapshot = await getSocialHubSnapshot(session, conversationId)
    return <SocialHub initialSnapshot={snapshot} initialTab={tab} />
  })
}
