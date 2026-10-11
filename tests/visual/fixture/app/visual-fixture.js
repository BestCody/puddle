'use client'
import shellStyles from "@/components/product-shell.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { DateSwipeWorkspaceV2 } from '@/components/date-swipe-workspace-v2'
import { FigmaDashboardSidebar } from '@/components/figma-dashboard-sidebar'
import { ProductNav } from '@/components/product-nav'
import { MainContentTransition } from '@/components/main-content-transition'
import { MapRouteClient } from '@/components/map-route-client'
import { FriendsRouteContent } from '@/components/friends-route-content'
import { snapshotForConversation } from '../mocks/data'

const items = Array.from({ length: 12 }, (_, index) => ({
  content_id: `visual-place-${index}`,
  location_id: `visual-place-${index}`,
  title: index % 2 ? 'An afternoon by the lake' : 'Maple Grove Park',
  category: 'park',
  distanceLabel: '208m',
  address_public: '2243 Devon Road, Oakville',
  summary: 'A quiet green space to explore with friends.',
  amenities: ['outdoor_seating', 'accessible'],
  photo_urls: ['/figma/assets/safety-toronto.webp']
}))

const feed = {
  items, categories: ['park', 'cafe'], centerLabel: 'Oakville',
  filters: { distance: 10, price: 'any', category: '', locationLabel: 'Oakville' },
  continuation: { hasMore: false }, requestId: 'visual-fixture'
}

export function VisualFixture({ view, children = null, conversationId = null, tab = 'messages' }) {
  return <div className={scopedClasses(shellStyles, "figma-dashboard-shell")} data-appearance="light">
    <FigmaDashboardSidebar avatarUrl="/figma/assets/logo.svg" />
    <div className={scopedClasses(shellStyles, "figma-dashboard-stage")}>
      <main className={scopedClasses(shellStyles, "figma-dashboard-main")}>
        <MainContentTransition>
          {children || (view === 'map' ? <MapRouteClient /> : view === 'matches' ? <FriendsRouteContent snapshot={snapshotForConversation(conversationId)} tab={tab} conversationId={conversationId} /> : <DateSwipeWorkspaceV2 initialFeed={feed} profileId="visual-test-user" />)}
        </MainContentTransition>
      </main>
    </div>
    <ProductNav mobile avatarUrl="/figma/assets/logo.svg" />
  </div>
}
