import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('solo swipe delivery keeps actions durable until acknowledgement and scoped to one profile', async () => {
  const source = await read('components/date-swipe-workspace-v2.js')
  const page = await read('app/(product)/discover/page.js')
  assert.match(source, /puddle:pending-discovery-actions:v1/)
  assert.match(source, /actionStorageKey\(profileId\)/)
  assert.match(source, /const entries = actionBuffer\.current\.slice\(0, ACTION_BATCH_SIZE\)/)
  const success = source.indexOf('if (!response.ok)')
  const acknowledgedRemoval = source.indexOf('actionBuffer.current.splice(0, entries.length)', success)
  assert.ok(success >= 0 && acknowledgedRemoval > success, 'the queue must not remove entries before the response is acknowledged')
  assert.match(source, /status === 429 \|\| status >= 500/)
  assert.match(source, /retryDelay\(retryAttempt\.current\+\+, error\?\.retryAfter\)/)
  assert.match(source, /storedDiscoveryActions\(storageKey\)/)
  assert.match(source, /persistDiscoveryActions\(actionBuffer\.current, storageKey\)/)
  assert.match(page, /profileId=\{session\.user\.id\}/)
})

test('explicitly moderated sessions are blocked without breaking missing-profile recovery', async () => {
  const proxy = await read('proxy.js')
  const session = await read('lib/supabase/proxy.js')
  const migration = await read('supabase/migrations/10045_runtime_integrity_hardening.sql')
  assert.match(session, /select\('suspended_at,banned_at'\)/)
  assert.match(proxy, /profileState\?\.suspended_at \|\| profileState\?\.banned_at/)
  assert.match(proxy, /\/api\/appeals/)

  assert.match(migration, /create or replace function public\.is_moderated_profile_v1/)
  assert.match(migration, /profile\.suspended_at is not null or profile\.banned_at is not null/)
  assert.match(migration, /set row_security=off/)
  assert.match(migration, /as restrictive for all to authenticated using \(not public\.is_moderated_profile_v1\(\)\)/)
  assert.match(migration, /relation\.relname not ilike '%appeal%'/)
  assert.match(migration, /create or replace function public\.reject_moderated_authenticated_write_v1/)
  assert.match(migration, /before insert or update or delete/)
  assert.match(migration, /and public\.is_moderated_profile_v1\(\)/)
  assert.doesNotMatch(migration, /not public\.is_active_profile_v1\(\) then/)
  assert.match(migration, /perform public\.assert_active_profile_v1\(\)/)
})

test('discovery retries are filtered by receipt before side effects run', async () => {
  const migration = await read('supabase/migrations/10045_runtime_integrity_hardening.sql')
  const filter = migration.indexOf('where not exists(')
  const unchecked = migration.indexOf('perform public.record_discovery_actions_v4_unchecked(pending_actions)')
  assert.ok(filter >= 0 && unchecked > filter)
  assert.match(migration, /receipt\.profile_id=actor/)
  assert.match(migration, /receipt\.event_id=\(source\.item->>'eventId'\)::uuid/)
})

test('discovery cards use canonical B2 photo URLs without a relational catalogue fallback', async () => {
  const card = await read('components/minimal-swipe-card.js')
  const discovery = await read('lib/app/discovery.js')
  const global = await read('lib/app/discovery-global.js')
  const photo = await read('lib/media/open-photo-url.js')

  assert.doesNotMatch(card, /usePrivateB2Asset|private_b2_asset|mainPhotoPending/)
  assert.match(global, /primary_photo/)
  assert.match(photo, /\/api\/open-photo\//)
  assert.doesNotMatch(discovery, /getRelationalDiscoveryFeed|discovery-relational|from\(['"]locations['"]\)/)
})

test('photo enrichment builds a global candidate lake and materializes canonical B2 media', async () => {
  const workflow = await read('.github/workflows/global-photo-enrichment.yml')
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /\bschedule:/)
  assert.match(workflow, /B2_MEDIA_APPLICATION_KEY_ID/)
  assert.match(workflow, /B2_MEDIA_APPLICATION_KEY/)
  assert.match(workflow, /build_wikimedia_candidates\.py/)
  assert.match(workflow, /build_mapillary_candidates\.py/)
  assert.match(workflow, /materialize_photo_candidates\.py/)
  assert.match(workflow, /media\/photos\/by-sha256/)
  assert.doesNotMatch(workflow, /PHOTO_ENRICH_SYNC_MEDIA|B2_INFRA_ENABLED|R2_CONFIG|R2_PUBLIC_BASE_URL/)
  assert.match(materializer, /sha256/i)
  assert.match(materializer, /B2_MEDIA_OPEN_PHOTO_PREFIX/)
})
