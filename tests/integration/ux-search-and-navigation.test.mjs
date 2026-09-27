import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('feed search filters indexed titles and bodies before cursor pagination', async () => {
  const [data, migration] = await Promise.all([
    read('lib/app/social-feed-data.js'),
    read('supabase/migrations/20260927173025_feed_search_index.sql')
  ])
  assert.match(data, /\.textSearch\('search_document', query, \{ type: 'websearch', config: 'simple' \}\)/)
  assert.match(migration, /coalesce\(title, ''\).*coalesce\(body, ''\)/)
  assert.match(migration, /using gin\s*\(search_document\)/)
  assert.doesNotMatch(data, /\.includes\(normalizedQuery\)/)
})

test('saved searches and categories filter the entire owned relation before keyset limit', async () => {
  const [migration, expansion, data, page, endpoint, collection, backfill] = await Promise.all([
    read('supabase/migrations/20260927175508_saved_search_filter_cutover.sql'),
    read('supabase/migrations/20260927174500_saved_reference_search.sql'),
    read('lib/app/location-plans-data.js'),
    read('app/(product)/plans/page.js'),
    read('app/api/saved-page/route.js'),
    read('components/saved-paged-grid.js'),
    read('scripts/backfill-location-ref-search.mjs')
  ])
  const savedFunction = migration.split('create or replace function public.location_saved_page_v1(')[1]
  assert.ok(savedFunction.indexOf('i.search_document @@') < savedFunction.indexOf('limit greatest'))
  assert.ok(savedFunction.indexOf('i.category=category_filter') < savedFunction.indexOf('limit greatest'))
  assert.match(migration, /s.profile_id=\(select auth.uid\(\)\)/)
  assert.match(expansion, /public.location_saved_categories_v1/)
  const separation = await read('supabase/migrations/20260927175506_saved_search_index_separation.sql')
  assert.match(separation, /public.location_ref_search_index/)
  assert.match(separation, /drop column if exists name/)
  assert.match(data, /rawRows\(session, active, decodedCursor, requested, active === 'saved' \? \{ category, query \} : undefined\)/)
  assert.match(page, /getSavedCategories\(session\)/)
  assert.match(endpoint, /supabase.auth.getUser\(\)/)
  assert.match(collection, /setItems\(\(current\) =>/)
  assert.match(collection, /data-testid="saved-next-page"/)
  assert.match(backfill, /getLocationsByIdsFromShards/)
  assert.match(backfill, /location_ref_index_checkpoint/)
  assert.match(backfill, /location_ref_index_progress_v1/)
})

test('profile friends open their own conversation and mobile navigation names every destination', async () => {
  const [profile, friendButton, nav, styles, onboarding] = await Promise.all([
    read('app/(product)/profile/page.js'),
    read('components/profile-friend-button.js'),
    read('components/product-nav.js'),
    read('app/figma-dashboard-rebuild.css'),
    read('components/onboarding-form.js')
  ])
  assert.match(profile, /readFriendCount\(session.supabase\)/)
  const countMigration = await read('supabase/migrations/20260927174740_profile_friend_count.sql')
  assert.match(countMigration, /p.suspended_at is null/)
  assert.match(countMigration, /public.blocks/)
  assert.match(profile, /ProfileFriendButton friendId=\{friend.id\}/)
  assert.match(friendButton, /social_open_direct_conversation_v1/)
  assert.match(nav, /figma-dashboard-nav-label">\{item.label\}/)
  assert.match(styles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/)
  assert.match(onboarding, /Start exploring/)
})
