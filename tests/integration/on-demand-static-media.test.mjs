import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('on-demand resolver stays explicitly disabled by default', async () => {
  const env = await read('.env.example')
  assert.match(env, /STATIC_MEDIA_RESOLUTION_ENABLED=false/)
  assert.match(env, /NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED=false/)
  assert.match(env, /B2_RUNTIME_WRITE_KEY_ID=\n/)
  assert.match(env, /B2_RUNTIME_WRITE_APPLICATION_KEY=\n/)
  assert.match(env, /B2_LAUNCH_MAX_BYTES=9000000000/)
  assert.match(env, /B2_PHOTO_START_MAX_BYTES=8900000000/)
  assert.match(env, /SUPABASE_LAUNCH_MAX_BYTES=400000000/)
  assert.match(env, /STATIC_MEDIA_B2_BASELINE_BYTES=\n/)
})

test('visible static cards use the guarded resolver without hidden-card prefetch', async () => {
  const card = await read('components/minimal-swipe-card.js')
  const hook = await read('lib/app/use-static-media-resolution.js')
  assert.match(card, /useStaticMediaResolution\(sourceItem\)/)
  assert.match(hook, /sourceItem\?\.static_catalogue_ephemeral/)
  assert.match(hook, /sourceItem\?\.static_ref/)
  assert.match(hook, /\/api\/static-catalogue\/media\//)
  assert.doesNotMatch(hook, /next card|prefetch/i)
})

test('resolver endpoint verifies caller, request and signed catalogue identity', async () => {
  const route = await read('app/api/static-catalogue/media/[id]/route.js')
  assert.match(route, /verifyCsrf\(request\)/)
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /enforceRateLimit/)
  assert.match(route, /verifyStaticCatalogueReference\(referenceToken, \{ expectedId: id \}\)/)
  assert.match(route, /Cache-Control': 'private, no-store'/)
})

test('catalogue reads and runtime photo writes use separate B2 credentials', async () => {
  const resolver = await read('lib/app/static-media-resolver.js')
  const writer = await read('lib/app/b2-runtime-writer.js')
  assert.match(resolver, /fetchStaticPlaceByReference\(reference, \{ fetchImpl: fetchPrivateB2Asset \}\)/)
  assert.match(resolver, /b2Writer = b2RuntimeWriterConfiguration\(\)/)
  assert.match(writer, /B2_RUNTIME_WRITE_KEY_ID/)
  assert.match(writer, /B2_RUNTIME_WRITE_APPLICATION_KEY/)
  assert.doesNotMatch(resolver, /B2_KEY_ID|B2_APPLICATION_KEY/)
})

test('runtime budgets cannot exceed launch ceilings', async () => {
  const resolver = await read('lib/app/static-media-resolver.js')
  const budgetMigration = await read('supabase/migrations/10041_on_demand_static_media_resolution.sql')
  const databaseGuard = await read('supabase/migrations/10042_on_demand_static_media_database_guard.sql')
  assert.match(resolver, /HARD_B2_MAX_BYTES = 9_000_000_000/)
  assert.match(resolver, /HARD_SUPABASE_MAX_BYTES = 400_000_000/)
  assert.match(resolver, /HARD_GOOGLE_MONTHLY_LIMIT = 5_000/)
  assert.match(resolver, /STATIC_MEDIA_B2_BASELINE_BYTES/)
  assert.match(budgetMigration, /least\(coalesce\(monthly_limit,0\),5000\)/)
  assert.match(budgetMigration, /least\(coalesce\(maximum_bytes_value,0\),9000000000\)/)
  assert.match(budgetMigration, /coalesce\(auth\.role\(\)::text,''\) <> 'service_role'/)
  assert.match(databaseGuard, /pg_database_size\(current_database\(\)\) >= 390000000/)
  assert.match(databaseGuard, /before insert on public\.static_media_resolution_states/)
})

test('Google matching stores stable identifiers rather than Google photo data', async () => {
  const resolver = await read('lib/app/static-media-resolver.js')
  assert.match(resolver, /places\.id,places\.displayName,places\.formattedAddress,places\.location,places\.primaryType/)
  assert.match(resolver, /google_place_value: best\.place\.id/)
  assert.doesNotMatch(resolver, /places\.photos|photoUri|photo_reference|photo_resource/i)
})

test('strict catalogue-wide audit is not weakened', async () => {
  const audit = await read('scripts/audit-static-catalogue-launch.mjs')
  assert.match(audit, /unsettledPhotoAttempts/)
  assert.match(audit, /unsettledGoogleAttempts/)
  assert.doesNotMatch(audit, /allow-on-demand-unsettled/)
})