import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../..', import.meta.url))
const source = (path) => readFile(join(root, path), 'utf8')

test('legacy shared-swipe data remains migratable while the product routes are retired', async () => {
  const migration = await source('supabase/migrations/10006_group_context_map_push.sql')
  const quorum = await source('supabase/migrations/10010_hangout_minimum_consensus.sql')
  const privateConsensus = await source('supabase/migrations/10011_private_shared_consensus.sql')
  const joinRecalculation = await source('supabase/migrations/10012_hangout_join_recalculation.sql')
  const cleanup = await source('supabase/migrations/10016_remove_notifications_and_pwa.sql')
  const startApi = await source('app/api/date-match/start/route.js')
  const actionApi = await source('app/api/date-match/action/route.js')
  const pairPage = await source('app/date-match/[token]/page.js')
  const hangoutPage = await source('app/hangout/[token]/page.js')
  const swipe = await source('components/date-swipe-workspace-v2.js')
  const proxy = await source('proxy.js')

  // Historical schema stays intact so old rows and migration history remain valid.
  assert.match(migration, /mode text not null default 'date'/)
  assert.match(migration, /max_members between 2 and 8/)
  assert.match(quorum, /target_mode='hangout' and member_count>=3/)
  assert.match(privateConsensus, /all_members_voted := vote_count = member_count/)
  assert.match(joinRecalculation, /delete from public\.date_match_matches/)
  assert.match(cleanup, /all_members_voted := vote_count = member_count/)
  assert.doesNotMatch(cleanup, /insert into public\.app_notifications/)

  // No new pair/group sessions can be created or used from the product.
  for (const retiredApi of [startApi, actionApi]) {
    assert.match(retiredApi, /status: 410/)
    assert.match(retiredApi, /retired/i)
  }
  assert.match(pairPage, /redirect\('\/matches'\)/)
  assert.match(hangoutPage, /redirect\('\/matches'\)/)
  assert.doesNotMatch(swipe, /InviteSheet|Invite others|createSharedDeck|\/api\/date-match\/start/)
  assert.match(proxy, /'\/hangout'/)
  assert.match(proxy, /'\/date-match'/)
})

test('contextual learning stays inside recommendation relevance', async () => {
  const events = await source('supabase/migrations/10006_group_context_map_push.sql')
  const merge = await source('supabase/migrations/10007_contextual_recommendation_merge.sql')
  const optimizedActions = await source('supabase/migrations/10026_r2_runtime_optimizations.sql')
  const discovery = await source('app/api/discovery/actions/route.js')
  assert.match(events, /recommendation_context_events/)
  assert.match(events, /daypart text not null/)
  assert.match(events, /mode text not null default 'solo'/)
  assert.match(merge, /positiveCategories/)
  assert.match(merge, /negativeCategories/)
  assert.match(merge, /contextualCategories/)
  assert.match(discovery, /context: safeContext\(value\.context\)/)
  assert.match(discovery, /record_discovery_actions_v3/)
  assert.doesNotMatch(discovery, /record_discovery_action_v[12]/)
  assert.match(optimizedActions, /record_recommendation_context_v1/)
  assert.match(optimizedActions, /context_payload=>coalesce\(context_payload,'\{\}'::jsonb\)/)
  assert.doesNotMatch(merge, /card_tier/)
  assert.doesNotMatch(merge, /confidence_adjusted_rating/)
})

test('focused map contains only saved, matched, and planned locations', async () => {
  const data = await source('lib/app/location-map-data.js')
  const page = await source('app/map/page.js')
  const map = await source('components/location-map.js')
  assert.match(data, /addState\(item\.location_id, 'saved'/)
  assert.match(data, /addState\(match\.location_id, 'matched'/)
  assert.match(data, /addState\(item\.location_id, 'planned'/)
  assert.doesNotMatch(data, /from\('events'\)/)
  assert.match(page, /never opens the retired event-discovery map/)
  assert.match(map, /tile\.openstreetmap\.org/)
  assert.match(map, /© OpenStreetMap contributors/)
})

test('the product opens on a minimal swipe-first interface', async () => {
  const dashboard = await source('app/dashboard/page.js')
  const layout = await source('app/layout.js')
  const nav = await source('components/product-nav.js')
  const shell = await source('components/product-shell.js')
  const swipe = await source('components/date-swipe-workspace-v2.js')
  const packageFile = JSON.parse(await source('package.json'))
  assert.match(dashboard, /redirect\('\/discover'\)/)
  assert.doesNotMatch(layout, /manifest\.webmanifest|PwaClient/)
  assert.deepEqual([...nav.matchAll(/label: '([^']+)'/g)].map((match) => match[1]), ['Swipe', 'Saved', 'Friends', 'Tiers', 'Profile'])
  assert.doesNotMatch(shell, /location-first|Better cards first|Find the date spot/)
  assert.match(swipe, /MinimalSwipeCard/)
  assert.match(swipe, /DiscoverSocialBar/)
  assert.doesNotMatch(swipe, /ChoiceNoteModal|Puddle Pick|recommendation|Invite others/)
  assert.equal(packageFile.scripts['notifications:push'], undefined)
  assert.equal(packageFile.scripts['vapid:generate'], undefined)
})
