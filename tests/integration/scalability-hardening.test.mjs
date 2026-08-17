import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('active messaging uses cursor-paged inbox and newest-first message pages', async () => {
  const data = await read('lib/app/social-hub-data.js')
  const ui = await read('components/figma-social-hub.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const edges = await read('supabase/migrations/10068_scalability_edge_hardening.sql')
  const bounds = await read('supabase/migrations/10069_scalability_work_bounds.sql')

  assert.match(data, /social_conversations_v2/)
  assert.match(data, /social_messages_v2/)
  assert.doesNotMatch(data, /social_conversations_v1/)
  assert.doesNotMatch(data, /social_messages_v1/)
  assert.match(ui, /Load older messages/)
  assert.match(ui, /Load more conversations/)
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

test('social feed uses exact keyset pages, indexed top-N comments, and lazy friend hydration', async () => {
  const feed = await read('lib/app/social-feed-data.js')
  const page = await read('app/map/page.js')
  const share = await read('app/map/feed-share-menu.js')
  const cursor = await read('supabase/migrations/10067_feed_keyset_pagination.sql')
  const edges = await read('supabase/migrations/10068_scalability_edge_hardening.sql')
  const bounds = await read('supabase/migrations/10069_scalability_work_bounds.sql')

  assert.match(feed, /DEFAULT_PAGE_SIZE = 25/)
  assert.match(feed, /social_feed_post_ids_v2/)
  assert.match(feed, /social_comment_previews_v2/)
  assert.match(feed, /per_post: 3/)
  assert.doesNotMatch(feed, /social_friends_v1/)
  assert.match(feed, /nextBeforeCreatedAt/)
  assert.match(feed, /nextBeforePostId/)
  assert.match(page, /More puddles/)
  assert.match(share, /social_friend_picker_v2/)
  assert.match(share, /More friends/)
  assert.match(cursor, /\(p\.created_at, p\.id\) < \(before_created_at, before_post_id\)/)
  assert.match(edges, /create or replace function public\.social_friend_picker_v2/)
  assert.match(bounds, /cross join lateral/)
  assert.match(bounds, /order by comment\.created_at desc, comment\.id desc/)
  assert.doesNotMatch(bounds, /row_number\(\) over/)
})

test('global discovery failures are isolated from the relational database', async () => {
  const discovery = await read('lib/app/discovery.js')
  const env = await read('.env.example')

  assert.match(discovery, /FAILURE_THRESHOLD = 3/)
  assert.match(discovery, /CIRCUIT_COOLDOWN_MS = 60_000/)
  assert.match(discovery, /global-location-stale-cache/)
  assert.match(discovery, /global-location-degraded/)
  assert.match(discovery, /markCached/)
  assert.match(discovery, /return emptyDegradedFeed\(session, filters, reason\)/)
  assert.match(discovery, /if \(!useGlobalLocationServing\(\)\) return getRelationalDiscoveryFeed\(session, filters, options\)/)
  assert.equal(discovery.match(/getRelationalDiscoveryFeed\(session, filters, options\)/g)?.length, 1)

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

test('legacy social readers delegate to bounded v2 contracts', async () => {
  const compatibility = await read('supabase/migrations/10066_scalability_compatibility.sql')

  assert.match(compatibility, /social_friend_search_v2\(search_term,30\)/)
  assert.match(compatibility, /social_friends_v2\(null,null,100\)/)
  assert.match(compatibility, /social_conversations_v2\(null,null,100\)/)
  assert.match(compatibility, /social_messages_v2\(target,null,100\)/)
})
