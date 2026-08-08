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
  assert.match(route, /state: 'google_server_photo'/)
  assert.match(route, /google_server_photo: true/)
  assert.match(route, /google_photo_proxy_url: googlePhotoProxyUrl/)
  assert.match(route, /google_lookup_min_score: config\.googleMinimumScore/)
  assert.doesNotMatch(route, /runtime_debug|staticMediaRuntimeDiagnostics/)
  assert.doesNotMatch(route, /staticMediaResolverConfiguration\(\)/)
})

test('historical no-match states are reopened once for the browser-fallback policy and then stay terminal', async () => {
  const policy = await read('lib/app/static-media-resolution-policy.js')
  assert.match(policy, /MATCH_POLICY = 'google-browser-fallback-v4'/)
  assert.match(policy, /current\?\.state !== 'no_match'/)
  assert.match(policy, /current\?\.last_error === CURRENT_NO_MATCH_MARKER/)
  assert.match(policy, /state: 'pending'/)
  assert.match(policy, /attempts: 0/)
  assert.match(policy, /last_error: RETRY_MARKER/)
  assert.match(policy, /last_error: CURRENT_NO_MATCH_MARKER/)
})

test('Google card photos use an authenticated no-store server proxy without persisting photo resources', async () => {
  const mediaRoute = await read('app/api/static-catalogue/media/[id]/route.js')
  const photoRoute = await read('app/api/static-catalogue/google-photo/[id]/route.js')
  const proxy = await read('lib/app/google-place-photo-proxy.js')
  const hook = await read('lib/app/use-static-media-resolution.js')
  const card = await read('components/minimal-swipe-card.js')
  const serverPhoto = await read('components/google-server-place-photo.js')
  const browserFallback = await read('components/google-place-photo-fallback.js')

  assert.match(mediaRoute, /google_photo_proxy_url/)
  assert.match(mediaRoute, /google_server_photo/)
  assert.doesNotMatch(mediaRoute, /google_place_value|upsert_static_location_asset_v1/)

  assert.match(photoRoute, /process\.env\.GOOGLE_PLACES_API_KEY/)
  assert.match(photoRoute, /supabase\.auth\.getUser\(\)/)
  assert.match(photoRoute, /static_google_photo/)
  assert.match(photoRoute, /verifyStaticCatalogueReference/)
  assert.match(photoRoute, /consume_static_google_runtime_budget_v1/)
  assert.match(photoRoute, /Cache-Control': 'private, no-store, max-age=0'/)

  assert.match(proxy, /places:searchText/)
  assert.match(proxy, /places\.photos/)
  assert.match(proxy, /\/media`/)
  assert.match(proxy, /'X-Goog-Api-Key': apiKey/)
  assert.match(proxy, /cache: 'no-store'/)
  assert.match(proxy, /scoreGooglePlaceMatch/)
  assert.match(proxy, /fetchStaticPlaceByReference/)
  assert.match(proxy, /authorAttributions/)
  assert.match(proxy, /googleMapsUri/)
  assert.doesNotMatch(proxy, /upsert|insert\(|update\(|location_photo_sources|static_location_assets/)

  assert.match(hook, /google_photo_proxy_url/)
  assert.match(hook, /google_server_photo/)
  assert.match(hook, /item\?\.photo_url \|\| item\?\.cover_url/)
  assert.match(card, /GoogleServerPlacePhoto/)
  assert.match(card, /google_photo_proxy_url/)
  assert.match(serverPhoto, /fetch\(url, \{ cache: 'no-store', credentials: 'same-origin' \}\)/)
  assert.match(serverPhoto, /URL\.createObjectURL/)
  assert.match(serverPhoto, />Google Maps</)
  assert.match(serverPhoto, /x-puddle-google-attributions/)
  assert.match(serverPhoto, /x-puddle-google-maps-uri/)

  assert.match(browserFallback, /auth_referrer_policy: 'origin'/)
  assert.doesNotMatch(browserFallback, /findGoogleUiKitPlace/)
})