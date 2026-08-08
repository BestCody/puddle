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

test('static cards prefetch only the next three open-photo candidates with bounded concurrency', async () => {
  const card = await read('components/minimal-swipe-card.js')
  const workspace = await read('components/date-swipe-workspace-v2.js')
  const hook = await read('lib/app/use-static-media-resolution.js')
  assert.match(card, /useStaticMediaResolution\(sourceItem\)/)
  assert.match(workspace, /feed\.items\.slice\(index \+ 1, index \+ 4\)/)
  assert.match(workspace, /prefetchStaticMedia\(upcoming, \{ limit: 3, concurrency: 3 \}\)/)
  assert.match(hook, /body: JSON\.stringify\(\{ ref: item\.static_ref, mode \}\)/)
  assert.match(hook, /mode === 'open_only'/)
  assert.match(hook, /Math\.min\(3, Number\(concurrency\)/)
  assert.match(hook, /hasKnownMedia\(item\)/)
  assert.match(hook, /resolvedMediaCache/)
  assert.match(hook, /openPrefetchAttempted/)
})

test('open-only prefetch cannot spend a Google lookup and visible failures expose safe Google diagnostics', async () => {
  const resolver = await read('lib/app/static-media-resolver.js')
  const openOnlyBranch = resolver.indexOf('if (openOnly) {')
  const googleLookup = resolver.indexOf('const google = await resolveGoogle')
  assert.ok(openOnlyBranch >= 0 && googleLookup > openOnlyBranch)
  assert.match(resolver, /Google Places is not configured\./)
  assert.match(resolver, /Google request budget is exhausted\./)
  assert.match(resolver, /google\.error \? `google: \$\{google\.error\}` : null/)
  assert.match(resolver, /OPEN_PHOTO_MISS_PREFIX/)
})

test('resolver endpoint verifies caller, signed identity, explicit runtime config, and prefetch mode', async () => {
  const route = await read('app/api/static-catalogue/media/[id]/route.js')
  assert.match(route, /verifyCsrf\(request\)/)
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /enforceRateLimit/)
  assert.match(route, /\['full', 'open_only'\]\.includes\(mode\)/)
  assert.match(route, /weight: mode === 'open_only' \? 2 : 5/)
  assert.match(route, /verifyStaticCatalogueReference\(referenceToken, \{ expectedId: id \}\)/)
  assert.match(route, /const config = staticMediaRuntimeConfiguration\(\)/)
  assert.match(route, /resolveStaticCatalogueMedia\(reference, \{ mode, config \}\)/)
  assert.match(route, /Cache-Control': 'private, no-store'/)
})

test('temporary media failures become retryable after one minute', async () => {
  const resolver = await read('lib/app/static-media-resolver.js')
  const retryMigration = await read('supabase/migrations/10044_static_media_retry_window.sql')
  assert.match(resolver, /lease_seconds: 60/)
  assert.match(resolver, /retry_after_seconds: 60/)
  assert.match(retryMigration, /retry_after_seconds integer default 60/)
  assert.match(retryMigration, /safe_retry integer := greatest\(60,/)
})

test('slow open-photo providers are bounded and KartaView timeout remains non-fatal', async () => {
  const provider = await read('lib/app/static-open-photo-provider.js')
  assert.match(provider, /provider: 'kartaview', maxAttempts: 1, baseDelayMs: 500, timeoutMs: 1_500/)
  assert.match(provider, /provider: 'mapillary', maxAttempts: 1, baseDelayMs: 500, timeoutMs: 2_000/)
  assert.match(provider, /provider: 'wikimedia-commons', maxAttempts: 1,/)
  assert.match(provider, /Promise\.all\(providers\.map/)
  assert.match(provider, /failures\.push\(`\$\{outcome\.provider\} lookup: \$\{outcome\.error\.message\}`\)/)
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