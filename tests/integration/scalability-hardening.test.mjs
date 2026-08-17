import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('active messaging uses cursor-paged inbox and newest-first message pages', async () => {
  const data = await read('lib/app/social-hub-data.js')
  const ui = await read('components/figma-social-hub.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.match(data, /social_conversations_v2/)
  assert.match(data, /social_messages_v2/)
  assert.doesNotMatch(data, /social_conversations_v1/)
  assert.doesNotMatch(data, /social_messages_v1/)
  assert.match(ui, /Load older messages/)
  assert.match(ui, /Load more conversations/)
  assert.match(migration, /last_message_id bigint/)
  assert.match(migration, /unread_count bigint not null default 0/)
  assert.match(migration, /order by m\.id desc limit page_limit/)
})

test('friend/profile search is trigram-backed and mutual friends are set-based', async () => {
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')
  const ui = await read('components/figma-social-hub.js')

  assert.match(migration, /profiles_username_trgm_idx/)
  assert.match(migration, /profiles_display_name_trgm_idx/)
  assert.match(migration, /candidate_friends as/)
  assert.match(migration, /join actor_friends af on af\.id=cf\.friend_id/)
  assert.doesNotMatch(migration, /from public\.profiles m where public\.profiles_are_friends/)
  assert.match(ui, /social_friend_search_v2/)
  assert.match(ui, /social_friends_v2/)
  assert.match(ui, /Load more friends/)
})

test('Pass heatmap is viewport-scoped and incrementally maintained', async () => {
  const data = await read('lib/app/location-map-data.js')
  const map = await read('components/location-map.js')
  const endpoint = await read('app/api/map/heatmap/route.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.doesNotMatch(data, /pass_location_heatmap_v1/)
  assert.match(map, /\/api\/map\/heatmap/)
  assert.match(endpoint, /pass_location_heatmap_viewport_v2/)
  assert.match(migration, /location_save_density_tiles/)
  assert.match(migration, /user_content_states_density_v1/)
  assert.match(migration, /tile_y between north_y and south_y/)
})

test('Pass saver listing is keyset-paged with a separate count', async () => {
  const studio = await read('app/studio/places/[id]/page.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.match(studio, /pass_location_savers_v2/)
  assert.match(studio, /pass_location_saver_count_v2/)
  assert.match(migration, /\(s\.created_at,s\.profile_id\)<\(before_saved_at,before_profile_id\)/)
  assert.match(migration, /limit page_limit/)
})

test('social feed bounds posts and comments without hydrating the full friend graph', async () => {
  const feed = await read('lib/app/social-feed-data.js')

  assert.match(feed, /DEFAULT_PAGE_SIZE = 25/)
  assert.match(feed, /social_comment_previews_v2/)
  assert.match(feed, /per_post: 3/)
  assert.doesNotMatch(feed, /social_friends_v1/)
  assert.match(feed, /nextBeforeCreatedAt/)
})

test('global discovery failures cannot stampede the relational database', async () => {
  const discovery = await read('lib/app/discovery.js')

  assert.match(discovery, /FAILURE_THRESHOLD = 3/)
  assert.match(discovery, /CIRCUIT_COOLDOWN_MS = 60_000/)
  assert.match(discovery, /GLOBAL_LOCATION_FALLBACK_TO_SUPABASE \|\| 'false'/)
  assert.match(discovery, /nextRelationalFallbackAt/)
  assert.match(discovery, /global-location-stale-cache/)
  assert.match(discovery, /global-location-degraded/)
})

test('legacy social readers delegate to bounded v2 contracts', async () => {
  const compatibility = await read('supabase/migrations/10066_scalability_compatibility.sql')

  assert.match(compatibility, /social_friend_search_v2\(search_term,30\)/)
  assert.match(compatibility, /social_friends_v2\(null,null,100\)/)
  assert.match(compatibility, /social_conversations_v2\(null,null,100\)/)
  assert.match(compatibility, /social_messages_v2\(target,null,100\)/)
})
