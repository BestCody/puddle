import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getMembershipSnapshot } from '../../lib/app/membership-data.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('creating a location is Pass-gated in the page, action, and database policy', async () => {
  const page = await read('app/(product)/create/place/page.js')
  const actions = await read('app/(product)/create/actions.js')
  const draftWriter = await read('lib/app/location-draft-write.js')
  const migration = await read('supabase/migrations/10059_pass_feature_entitlements.sql')

  assert.match(page, /membership\.active \? <LocationEditor/)
  assert.match(page, /const membership = await getMembershipSnapshot\(session\)/)
  assert.match(page, /const options = membership\.active \? await getCreatorOptions\(session\) : null/)
  assert.match(actions, /saveLocationSubmission/)
  assert.match(draftWriter, /puddle_tinder_active_v1/)
  assert.match(migration, /create policy "pass users create locations"/)
})

test('membership reads only membership data', async () => {

  const tables = []
  const session = {
    user: { id: 'test-user' },
    profile: { birth_date: '2000-01-01' },
    supabase: {
      from(table) {
        tables.push(table)
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() { return { data: { tier: 'free', status: 'inactive' }, error: null } }
        }
      }
    }
  }
  const snapshot = await getMembershipSnapshot(session)
  assert.deepEqual(tables, ['puddle_memberships'])
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.adult, true)
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
