'use client'

import dynamic from 'next/dynamic'

const FigmaMessagesRealtime = dynamic(() => import('./figma-messages-realtime').then((module) => module.FigmaMessagesRealtime))
const FigmaSocialHub = dynamic(() => import('./figma-social-hub').then((module) => module.FigmaSocialHub))
const PassMessageSearch = dynamic(() => import('./pass-message-search').then((module) => module.PassMessageSearch))

export function FriendsRouteContent({ snapshot, tab, conversationId }) {
  return <div className="figma-friends-pass-wrapper">
    {tab === 'add' && snapshot.passActive ? <PassMessageSearch enabled /> : null}
    {tab === 'messages'
      ? <FigmaMessagesRealtime initialSnapshot={snapshot} conversationId={conversationId} />
      : <FigmaSocialHub initialSnapshot={snapshot} initialTab={tab} />}
  </div>
}
