import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('saved, plans, and history use bounded keyset pages instead of lifetime hydration', async () => {
  const [data, page, migration] = await Promise.all([
    read('lib/app/location-plans-data.js'),
    read('app/(product)/plans/page.js'),
    read('supabase/migrations/10070_location_history_single_photo.sql')
  ])

  assert.match(data, /LOCATION_HISTORY_PAGE_SIZE = 24/)
  assert.match(data, /LOCATION_HISTORY_MAX_PAGE_SIZE = 40/)
  for (const rpc of ['location_saved_page_v1', 'location_planned_page_v1', 'location_history_page_v1']) {
    assert.match(data, new RegExp(rpc))
    assert.match(migration, new RegExp(String.raw`create or replace function public\.${rpc}`))
  }
  assert.doesNotMatch(data, /\.from\('user_content_states'\)/)
  assert.doesNotMatch(data, /\.from\('location_visits'\)/)
  assert.doesNotMatch(data, /limit\(1000\)/)
  assert.match(page, /getLocationPlansPage/)
  assert.match(page, /saved-next-page/)
  assert.match(migration, /before_sort_at/)
  assert.match(migration, /after_sort_at/)
  assert.match(migration, /limit greatest\(1,least\(coalesce\(result_limit,25\),41\)\)/)
  assert.match(migration, /limit 12/)
})

test('production location media has an exact one-photo invariant', async () => {
  const [migration, publicLocation, socialFeed] = await Promise.all([
    read('supabase/migrations/10070_location_history_single_photo.sql'),
    read('lib/app/public-location-cache.js'),
    read('lib/app/social-feed-data.js')
  ])

  assert.match(migration, /location_photo_sources_one_approved_idx/)
  assert.match(migration, /where status='approved'/)
  assert.match(migration, /location_media_one_asset_idx/)
  assert.match(migration, /enforce_single_approved_location_photo_v1/)
  assert.match(publicLocation, /openPhotoUrlForHash\(photo\.content_hash\)/)
  assert.doesNotMatch(publicLocation, /from\('location_media'\)/)
  assert.match(publicLocation, /gallery: \[\]/)
  assert.doesNotMatch(publicLocation, /galleryFor/)
  assert.match(socialFeed, /slice\(0, 1\)/)
  assert.doesNotMatch(socialFeed, /slice\(0, 5\)/)
  assert.doesNotMatch(socialFeed, /list\.length < 5/)
})

test('global detail serving fails closed instead of falling back to Postgres', async () => {
  const publicLocation = await read('lib/app/public-location-cache.js')
  assert.match(publicLocation, /getGlobalLocationBySlug/)
  assert.match(publicLocation, /searchGlobalLocations/)
  assert.match(publicLocation, /getCachedPublicLocationRecommendations/)
  assert.match(publicLocation, /relatedEvents/)
  assert.match(publicLocation, /isLocationSuspended/)
  assert.doesNotMatch(publicLocation, /GLOBAL_LOCATION_FALLBACK_TO_SUPABASE/)
  assert.doesNotMatch(publicLocation, /transitional Supabase fallback/)
  assert.doesNotMatch(publicLocation, /from\(['"]locations['"]\)|loadRelationalPublicLocation|useGlobal/)
})

test('production SLO observations and trace IDs cover Vercel, Supabase, and B2', async () => {
  const [metrics, discovery, map, instrumentation, docs] = await Promise.all([
    read('lib/performance/server-latency.js'),
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js'),
    read('instrumentation.js'),
    read('docs/operations/production-slos.md')
  ])

  assert.match(metrics, /PRODUCTION_SLOS/)
  assert.match(metrics, /puddle_slo_observation/)
  assert.match(metrics, /createTraceId/)
  assert.match(discovery, /x-puddle-trace-id/)
  assert.match(discovery, /service: 'b2'/)
  assert.match(discovery, /service: 'supabase'/)
  assert.match(map, /x-puddle-trace-id/)
  assert.match(map, /service: 'b2'/)
  assert.match(instrumentation, /onRequestError/)
  assert.match(docs, /Request SLOs/)
  assert.match(docs, /Dependency SLOs/)
})

test('CI E2E Supabase reserves a free port block instead of assuming fixed host ports', async () => {
  const workflow = await read('.github/workflows/e2e.yml')
  assert.match(workflow, /import socket/)
  assert.match(workflow, /for candidate in range\(55320, 59000, 10\)/)
  assert.match(workflow, /Could not find seven consecutive free Supabase ports/)
  for (const port of [55320, 55321, 55322, 55323, 55324, 55325, 55326]) {
    assert.doesNotMatch(workflow, new RegExp(`(?:port|shadow_port|smtp_port|pop3_port) = ${port}`))
  }
})

test('the production social-feed repair is a targeted authenticated migration', async () => {
  const workflow = await read('.github/workflows/apply-social-feed-hot-path.yml')
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/)
  assert.match(workflow, /supabase db query/)
  assert.match(workflow, /--project-ref cegoqtvajwajczbofpep/)
  assert.match(workflow, /20260825024000_restore_social_feed_hot_path\.sql/)
  assert.doesNotMatch(workflow, /db push/)
})

test('the live production gate load-tests every critical read path with bounded concurrency', async () => {
  const [load, workflow] = await Promise.all([
    read('tests/live/production-load.spec.mjs'),
    read('.github/workflows/live-production-smoke.yml')
  ])

  assert.match(load, /STAGES = \[5, 10, 20\]/)
  for (const scenario of ['discovery', 'mapViewport', 'socialFeed', 'savedHistory', 'locationDetail']) {
    assert.match(load, new RegExp(`'${scenario}'`))
  }
  assert.match(load, /puddle_production_load_result/)
  assert.match(workflow, /production-load:/)
  assert.match(workflow, /workflow_dispatch/)
  assert.doesNotMatch(workflow, /if: github\.event_name == 'pull_request'/)
  assert.match(workflow, /Run live product UI smoke/)
  assert.match(workflow, /Run bounded production load until SLOs pass/)
  assert.match(workflow, /tests\/live\/production-load\.spec\.mjs/)
})
