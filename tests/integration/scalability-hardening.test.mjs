import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('active messaging uses cursor-paged inbox and newest-first message pages', async () => {
  const data = await read('lib/app/social-hub-data.js')
  const ui = await read('components/figma-messages-realtime.js')
  const matchesPage = await read('app/(product)/matches/page.js')
  const mobileStyles = await read('app/ui-fixes-20260822.css')
  const densityStyles = await read('app/responsive-density-20260822.css')
  const messagesStyles = await read('app/messages-realtime-polish.css')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const edges = await read('supabase/migrations/10068_scalability_edge_hardening.sql')
  const bounds = await read('supabase/migrations/10069_scalability_work_bounds.sql')

  assert.match(data, /social_conversations_v2/)
  assert.match(data, /social_messages_v2/)
  assert.doesNotMatch(data, /social_conversations_v1/)
  assert.doesNotMatch(data, /social_messages_v1/)
  assert.match(ui, /Load older messages/)
  assert.match(ui, /Load more conversations/)
  assert.match(ui, /<Link[\s\S]*href="\/matches\?tab=messages"[\s\S]*replace[\s\S]*aria-label="Back to conversations"/)
  assert.match(ui, /conversationId = null/)
  assert.match(ui, /matchMedia\('\(max-width: 760px\)'\)/)
  assert.match(ui, /isMobile === true && !conversationId/)
  assert.match(ui, /mobileModePending = isMobile === null && !conversationId/)
  assert.match(ui, /isConversationOpen = Boolean\(selected\) && !mobileModePending/)
  assert.match(ui, /is-mobile-mode-pending/)
  assert.match(ui, /is-conversation-open/)
  assert.match(matchesPage, /<FigmaMessagesRealtime initialSnapshot=\{snapshot\} conversationId=\{conversationId\} \/>/)
  assert.doesNotMatch(mobileStyles, /\.figma-friends-screen\.is-messages/)
  assert.doesNotMatch(densityStyles, /@media \(max-width: 760px\)[\s\S]*\.figma-friends-screen\.is-messages/)
  assert.match(messagesStyles, /@media \(max-width: 760px\)[\s\S]*height: calc\(100dvh - var\(--puddle-mobile-content-bottom\)\)/s)
  assert.match(messagesStyles, /\.figma-friends-screen\.is-messages \.figma-friends-message-layout\s*\{[\s\S]*inset: auto !important;[\s\S]*grid-template-rows: minmax\(0, 1fr\);/s)
  assert.match(messagesStyles, /\.figma-friends-screen\.is-messages:not\(.is-conversation-open\) \.figma-friends-conversations\s*\{[\s\S]*height: 100%;/s)
  assert.match(messagesStyles, /\.figma-friends-screen\.is-messages\.is-conversation-open \.figma-friends-chat\s*\{[\s\S]*display: flex !important;/s)
  assert.match(messagesStyles, /\.figma-friends-screen\.is-messages\.is-conversation-open \.figma-friends-messages\s*\{[\s\S]*bottom: 4\.75rem;/s)
  assert.match(messagesStyles, /\.figma-friends-screen\.is-messages\.is-conversation-open \.figma-friends-composer\s*\{[\s\S]*bottom: \.75rem;/s)
  assert.doesNotMatch(mobileStyles, /\.figma-friends-screen\.is-messages\.is-conversation-open \.figma-friends-chat\s*\{[\s\S]*position: fixed !important;/s)
  assert.match(migration, /last_message_id bigint/)
  assert.match(migration, /unread_count bigint not null default 0/)
  assert.match(migration, /order by m\.id desc limit page_limit/)
  assert.match(edges, /next_unread/)
  assert.match(bounds, /latest_id bigint/)
})

test('friend/profile search is trigram-backed, mutual friends are set-based, and the add screen avoids eager friend hydration', async () => {
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const ui = await read('components/figma-social-hub.js')

  assert.match(migration, /profiles_username_trgm_idx/)
  assert.match(migration, /profiles_display_name_trgm_idx/)
  assert.match(migration, /candidate_friends as/)
  assert.match(migration, /join actor_friends af on af\.id=cf\.friend_id/)
  assert.doesNotMatch(migration, /from public\.profiles m where public\.profiles_are_friends/)
  assert.match(migration, /create or replace function public\.social_friends_v2/)
  assert.match(ui, /social_friend_search_v2/)
  assert.doesNotMatch(ui, /social_friends_v2/)
  assert.doesNotMatch(ui, /Load more friends/)
})

test('Pass heatmap is viewport-scoped and incrementally maintained', async () => {
  const data = await read('lib/app/location-map-data.js')
  const map = await read('components/location-map.js')
  const endpoint = await read('app/api/map/heatmap/route.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const edges = await read('supabase/migrations/10068_scalability_edge_hardening.sql')

  assert.doesNotMatch(data, /pass_location_heatmap_v1/)
  assert.match(map, /\/api\/map\/heatmap/)
  assert.match(endpoint, /pass_location_heatmap_viewport_v2/)
  assert.match(migration, /location_save_density_tiles/)
  assert.match(migration, /user_content_states_density_v1/)
  assert.match(migration, /tile_y between north_y and south_y/)
  assert.match(edges, /locations_density_delete_v1/)
  assert.match(edges, /profiles_density_delete_v1/)
})

test('Pass saver listing is keyset-paged and its headline count is incrementally maintained', async () => {
  const studio = await read('app/studio/places/[id]/page.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const bounds = await read('supabase/migrations/10069_scalability_work_bounds.sql')

  assert.match(studio, /pass_location_savers_v2/)
  assert.match(studio, /pass_location_saver_count_v2/)
  assert.match(studio, /total .*save/)
  assert.match(migration, /\(s\.created_at,s\.profile_id\)<\(before_saved_at,before_profile_id\)/)
  assert.match(migration, /limit page_limit/)
  assert.match(bounds, /create table if not exists public\.location_save_counts/)
  assert.match(bounds, /adjust_location_save_count_v1/)
  assert.match(bounds, /from public\.location_save_counts c/)
})

test('social feed uses bounded RLS keyset pages, indexed top-N comment previews, and lazy friend hydration', async () => {
  const feed = await read('lib/app/social-feed-data.js')
  const page = await read('components/map-route-client.js')
  const client = await read('components/social-feed-client.js')
  const share = await read('app/(product)/map/feed-share-menu.js')
  const cursor = await read('supabase/migrations/10067_feed_keyset_pagination.sql')
  const edges = await read('supabase/migrations/10068_scalability_edge_hardening.sql')
  const bounds = await read('supabase/migrations/10069_scalability_work_bounds.sql')
  const restore = await read('supabase/migrations/20260825024000_restore_social_feed_hot_path.sql')

  assert.match(feed, /DEFAULT_PAGE_SIZE = 3/)
  assert.match(feed, /\.from\('social_posts'\)[\s\S]*profiles!social_posts_author_id_fkey/)
  assert.match(feed, /\.order\('created_at', \{ ascending: false \}\)[\s\S]*\.order\('id', \{ ascending: false \}\)/)
  assert.match(feed, /pageSize \+ 1/)
  assert.doesNotMatch(feed, /rpc\('social_feed_post_ids_v2'/)
  assert.match(feed, /rpc\('social_comment_previews_v2'/)
  assert.match(feed, /per_post: 3/)
  assert.doesNotMatch(feed, /social_comment_previews_fallback/)
  assert.match(feed, /if \(list\.length < 3\)/)
  assert.doesNotMatch(feed, /social_friends_v1/)
  assert.match(feed, /nextBeforeCreatedAt/)
  assert.match(feed, /nextBeforePostId/)
  assert.match(page, /<SocialFeedClient/)
  assert.match(client, /More puddles/)
  assert.match(client, /function nextFeedQuery\(query, pagination\)/)
  assert.match(client, /function FeedPagination\(/)
  assert.match(client, /onClick=\{onLoadMore\}/)
  assert.match(client, /setFeed\(\(current\) =>/)
  assert.match(client, /const seenIds = new Set\(\)/)
  assert.doesNotMatch(client, /<Link href=\{moreHref\}>More puddles<\/Link>/)
  assert.match(share, /social_friend_picker_v2/)
  assert.match(share, /More friends/)
  assert.match(cursor, /\(p\.created_at, p\.id\) < \(before_created_at, before_post_id\)/)
  assert.match(edges, /create or replace function public\.social_friend_picker_v2/)
  assert.match(bounds, /cross join lateral/)
  assert.match(bounds, /order by comment\.created_at desc, comment\.id desc/)
  assert.match(restore, /social_posts_feed_keyset_idx/)
  assert.match(restore, /social_comments_post_preview_idx/)
  assert.match(restore, /cross join lateral/)
  assert.doesNotMatch(bounds, /row_number\(\) over/)
})

test('global discovery failures are isolated from the relational database', async () => {
  const discovery = await read('lib/app/discovery.js')
  const env = await read('.env.example')

  assert.doesNotMatch(discovery, /FAILURE_THRESHOLD|CIRCUIT_COOLDOWN_MS|global-location-stale-cache|global-location-degraded|emptyDegradedFeed|markCached/)
  assert.match(discovery, /getGlobalDiscoveryFeed/)
  assert.doesNotMatch(discovery, /getRelationalDiscoveryFeed|discovery-relational|from\(['"]locations['"]\)/)

  for (const forbidden of [
    'GLOBAL_LOCATION_FALLBACK_TO_SUPABASE',
    'GLOBAL_LOCATION_EMERGENCY_RELATIONAL_FALLBACK',
    'GLOBAL_LOCATION_RELATIONAL_FALLBACK_MIN_INTERVAL_MS',
    'nextRelationalFallbackAt',
    'relational-discovery-fallback'
  ]) {
    assert.doesNotMatch(discovery, new RegExp(forbidden))
    if (forbidden.startsWith('GLOBAL_')) assert.doesNotMatch(env, new RegExp(forbidden))
  }

  assert.match(env, /never fail over to Supabase\/Postgres/)
})

test('temporary v1 social RPC compatibility wrappers are dropped after the v2 cutover', async () => {
  const cleanup = await read('supabase/migrations/10074_drop_legacy_social_rpc_compatibility.sql')
  const activeData = await read('lib/app/social-hub-data.js')
  const activeFeed = await read('lib/app/social-feed-data.js')

  for (const signature of [
    'social_friend_search_v1\\(text\\)',
    'pass_message_search_v1\\(text\\)',
    'social_friends_v1\\(\\)',
    'social_conversations_v1\\(\\)',
    'social_messages_v1\\(uuid\\)'
  ]) {
    assert.match(cleanup, new RegExp(`drop function if exists public\\.${signature}`))
  }
  assert.doesNotMatch(activeData, /social_(?:friend_search|friends|conversations|messages)_v1/)
  assert.doesNotMatch(activeFeed, /social_friends_v1/)
})
