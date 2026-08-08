import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('production media route reads Google matching configuration at server runtime', async () => {
  const runtimeConfig = await read('lib/app/static-media-runtime-config.js')
  const route = await read('app/api/static-catalogue/media/[id]/route.js')

  for (const variable of [
    'STATIC_MEDIA_RESOLUTION_ENABLED',
    'NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED',
    'STATIC_MEDIA_GOOGLE_DAILY_LIMIT',
    'STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT',
    'GOOGLE_PLACE_MATCH_MIN_SCORE',
    'GOOGLE_PLACE_MATCH_TIMEOUT_MS',
    'STATIC_MEDIA_B2_BASELINE_BYTES',
    'B2_PHOTO_START_MAX_BYTES',
    'STATIC_MEDIA_PHOTO_RESERVATION_BYTES',
    'SUPABASE_LAUNCH_MAX_BYTES'
  ]) {
    assert.match(runtimeConfig, new RegExp(`process\\.env\\.${variable}`))
  }

  assert.match(runtimeConfig, /process\.env\.GOOGLE_PLACES_API_KEY/)
  assert.match(runtimeConfig, /Reflect\.get\(process\.env, name\)/)
  assert.match(runtimeConfig, /GOOGLE_PLACES_API_KEY: runtimeValue\('GOOGLE_PLACES_API_KEY'\)/)
  assert.doesNotMatch(runtimeConfig, /google_key_direct_visible|google_key_dynamic_visible|runtimeDiagnostics/)
  assert.doesNotMatch(runtimeConfig, /googleApiKey.*slice|GOOGLE_PLACES_API_KEY.*length/)

  assert.match(route, /const config = staticMediaRuntimeConfiguration\(\)/)
  assert.match(route, /const admin = createAdminClient\(\)/)
  assert.match(route, /reopenLegacyNoMatch\(admin, reference\)/)
  assert.match(route, /resolveStaticCatalogueMedia\(reference, \{ mode, config, admin \}\)/)
  assert.match(route, /markCurrentNoMatch\(admin, reference\)/)
  assert.match(route, /serverGoogleUnavailable\(config, payload\)/)
  assert.match(route, /consume_static_google_runtime_budget_v1/)
  assert.match(route, /state: 'google_client_lookup'/)
  assert.match(route, /google_client_lookup: true/)
  assert.match(route, /google_lookup_min_score: config\.googleMinimumScore/)
  assert.doesNotMatch(route, /runtime_debug|staticMediaRuntimeDiagnostics/)
  assert.doesNotMatch(route, /staticMediaResolverConfiguration\(\)/)
})

test('historical no-match states are reopened once for the browser-fallback policy and then stay terminal', async () => {
  const policy = await read('lib/app/static-media-resolution-policy.js')
  assert.match(policy, /MATCH_POLICY = 'google-browser-fallback-v3'/)
  assert.match(policy, /current\?\.state !== 'no_match'/)
  assert.match(policy, /current\?\.last_error === CURRENT_NO_MATCH_MARKER/)
  assert.match(policy, /state: 'pending'/)
  assert.match(policy, /attempts: 0/)
  assert.match(policy, /last_error: RETRY_MARKER/)
  assert.match(policy, /last_error: CURRENT_NO_MATCH_MARKER/)
})

test('browser Google fallback stays budget-gated and never persists client identity', async () => {
  const route = await read('app/api/static-catalogue/media/[id]/route.js')
  const hook = await read('lib/app/use-static-media-resolution.js')
  const card = await read('components/minimal-swipe-card.js')
  const fallback = await read('components/google-place-photo-fallback.js')

  assert.match(route, /authorizeBrowserGoogleLookup\(admin, config\)/)
  assert.match(route, /daily_limit: config\.googleDailyLimit/)
  assert.match(route, /monthly_limit: config\.googleMonthlyLimit/)
  assert.match(hook, /result\?\.google_client_lookup/)
  assert.match(hook, /'google_client_lookup'/)
  assert.match(card, /item\.google_place_id \|\| googleLookup/)
  assert.match(fallback, /gmp-place-details-place-request/)
  assert.match(fallback, /gmp-place-details-location-request/)
  assert.match(fallback, /lookup\?\.latitude/)
  assert.match(fallback, /lookup\?\.longitude/)
  assert.doesNotMatch(fallback, /findGoogleUiKitPlace/)
  assert.doesNotMatch(route, /google_place_value|upsert_static_location_asset_v1/)
  assert.doesNotMatch(fallback, /fetch\([^)]*static_location_assets|supabase/i)
})
