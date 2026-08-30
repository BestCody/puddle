import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Pass page keeps the six advertised feature promises', async () => {
  const membership = await read('app/(product)/membership/page.js')
  for (const feature of ['Heatmap', 'Pass badge', 'Create your location', 'Message anyone', 'See who saved', 'Notification alerts']) {
    assert.match(membership, new RegExp(`>${feature}<`))
  }
})

test('Pass heatmap uses incremental density tiles and viewport requests', async () => {
  const data = await read('lib/app/location-map-data.js')
  const map = await read('components/location-map.js')
  const route = await read('app/api/map/heatmap/route.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.doesNotMatch(data, /rpcOr\(session, 'pass_location_heatmap_v1'/)
  assert.match(map, /\/api\/map\/heatmap/)
  assert.match(map, /viewportBounds\(center, zoom, viewport\)/)
  assert.match(map, /location-map-heatmap-toggle/)
  assert.match(route, /pass_location_heatmap_viewport_v2/)
  assert.match(migration, /create table if not exists public\.location_save_density_tiles/)
  assert.match(migration, /sync_location_save_density_state_v1/)
})

test('creating a location is Pass-gated in the page, action, and database policy', async () => {
  const page = await read('app/(product)/create/place/page.js')
  const actions = await read('app/(product)/create/actions.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(page, /membership\.active \? <LocationEditor/)
  assert.match(actions, /puddle_tinder_active_v1/)
  assert.match(migration, /create policy "pass users create locations"/)
})

test('Message anyone uses trigram-backed Pass search and guarded direct conversations', async () => {
  const search = await read('components/pass-message-search.js')
  const pass = await read('supabase/migrations/10059_pass_feature_entitlements.sql')
  const scale = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.match(search, /pass_message_search_v2/)
  assert.match(search, /pass_open_direct_conversation_v1/)
  assert.match(scale, /profiles_username_trgm_idx/)
  assert.match(scale, /create or replace function public\.pass_message_search_v2/)
  assert.match(pass, /public\.puddle_adult_v1\(target\)/)
  assert.match(pass, /public\.blocks/)
})

test('Pass owners get a bounded saver page and a separate total count', async () => {
  const studio = await read('app/studio/places/[id]/page.js')
  const migration = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.match(studio, /pass_location_savers_v2/)
  assert.match(studio, /pass_location_saver_count_v2/)
  assert.match(studio, /result_limit: 50/)
  assert.match(studio, /Next savers/)
  assert.match(migration, /limit page_limit/)
})

test('Pass notification alerts are realtime, permission-gated, and activate immediately', async () => {
  const alerts = await read('components/pass-notification-alerts.js')
  const runtime = await read('components/dashboard-runtime.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(alerts, /Notification\.requestPermission/)
  assert.match(alerts, /postgres_changes/)
  assert.match(alerts, /PERMISSION_EVENT/)
  assert.match(runtime, /<PassNotificationAlerts enabled=\{Boolean\(bootstrap\?\.passActive\)\}/)
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/)
})

test('Profile identity stays faithful to Figma instead of injecting a Pass badge beside the name', async () => {
  const profile = await read('app/(product)/profile/page.js')
  assert.match(profile, /data-figma-node="40:347"/)
  assert.doesNotMatch(profile, /figma-profile-pass-badge/)
  assert.doesNotMatch(profile, /figma-profile-name-row/)
})

test('Settings is centered in both axes inside the dashboard viewport', async () => {
  const account = await read('app/account/page.js')
  const css = await read('app/pass-feature-completion.css')
  const layout = await read('app/global.css')

  assert.match(account, /section-\$\{selectedSection\}/)
  assert.match(css, /\.figma-settings-screen[\s\S]*display: grid !important;[\s\S]*place-items: center !important;/)
  assert.match(css, /height: 100vh;/)
  assert.match(css, /\.figma-settings-window[\s\S]*top: auto !important;[\s\S]*transform: none !important;/)
  assert.match(layout, /@import '\.\/pass-feature-completion\.css';/)
})

test('feature migrations have a unique dependency-safe order', async () => {
  const functional = await read('supabase/migrations/10057_functional_feature_completion.sql')
  const notifications = await read('supabase/migrations/10058_notification_preference_enforcement.sql')
  const pass = await read('supabase/migrations/10059_pass_feature_entitlements.sql')
  const scale = await read('supabase/migrations/10065_scalability_hardening.sql')

  assert.match(functional, /create table if not exists public\.social_posts/)
  assert.match(notifications, /category_enabled/)
  assert.match(pass, /social_conversation_peer_v2/)
  assert.match(scale, /social_messages_v2/)
})
