import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Pass page keeps the six advertised feature promises', async () => {
  const membership = await read('app/membership/page.js')
  for (const feature of ['Heatmap', 'Pass badge', 'Create your location', 'Message anyone', 'See who saved', 'Notification alerts']) {
    assert.match(membership, new RegExp(`>${feature}<`))
  }
})

test('Pass heatmap is backed by an entitlement RPC and rendered on the map', async () => {
  const data = await read('lib/app/location-map-data.js')
  const map = await read('components/location-map.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(data, /pass_location_heatmap_v1/)
  assert.match(map, /heatmapPoints/)
  assert.match(map, /location-map-heatmap-toggle/)
  assert.match(migration, /create or replace function public\.pass_location_heatmap_v1/)
  assert.match(migration, /public\.puddle_tinder_active_v1\(auth\.uid\(\)\)/)
})

test('creating a location is Pass-gated in the page, action, and database policy', async () => {
  const page = await read('app/create/place/page.js')
  const actions = await read('app/create/actions.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(page, /membership\.active \? <LocationEditor/)
  assert.match(actions, /puddle_tinder_active_v1/)
  assert.match(migration, /create policy "pass users create locations"/)
})

test('Message anyone uses Pass-only search and guarded direct-conversation RPCs', async () => {
  const search = await read('components/pass-message-search.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(search, /pass_message_search_v1/)
  assert.match(search, /pass_open_direct_conversation_v1/)
  assert.match(migration, /public\.puddle_adult_v1\(target\)/)
  assert.match(migration, /profile_visibility, 'public'\) <> 'hidden'/)
  assert.match(migration, /public\.blocks/)
})

test('Pass owners can see visible profiles who saved locations they manage', async () => {
  const studio = await read('app/studio/places/[id]/page.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(studio, /pass_location_savers_v1/)
  assert.match(studio, /See who saved/)
  assert.match(migration, /location\.created_by = actor/)
  assert.match(migration, /profile_visibility, 'public'\) <> 'hidden'/)
})

test('Pass notification alerts are realtime, permission-gated, and activate immediately', async () => {
  const alerts = await read('components/pass-notification-alerts.js')
  const shell = await read('components/product-shell.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(alerts, /Notification\.requestPermission/)
  assert.match(alerts, /postgres_changes/)
  assert.match(alerts, /PERMISSION_EVENT/)
  assert.match(shell, /<PassNotificationAlerts enabled=\{passActive\}/)
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/)
})

test('active Pass renders a profile badge', async () => {
  const profile = await read('app/profile/page.js')
  assert.match(profile, /membership\.active \? <Link className="figma-profile-pass-badge"/)
  assert.match(profile, />PASS<\/Link>/)
})

test('Settings is centered in both axes inside the dashboard viewport', async () => {
  const account = await read('app/account/page.js')
  const css = await read('app/pass-feature-completion.css')
  const layout = await read('app/layout.js')

  assert.match(account, /section-\$\{selectedSection\}/)
  assert.match(css, /\.figma-settings-screen[\s\S]*display: grid !important;[\s\S]*place-items: center !important;/)
  assert.match(css, /height: 100vh;/)
  assert.match(css, /\.figma-settings-window[\s\S]*top: auto !important;[\s\S]*transform: none !important;/)
  assert.match(layout, /import '\.\/pass-feature-completion\.css'/)
})

test('feature migrations have a unique dependency-safe order', async () => {
  const functional = await read('supabase/migrations/10057_functional_feature_completion.sql')
  const notifications = await read('supabase/migrations/10058_notification_preference_enforcement.sql')
  const pass = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(functional, /create table if not exists public\.social_posts/)
  assert.match(notifications, /category_enabled/)
  assert.match(pass, /social_conversation_peer_v2/)
})
