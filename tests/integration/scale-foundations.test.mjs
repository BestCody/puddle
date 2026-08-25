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
    assert.match(migration, new RegExp(`create or replace function public\.${rpc}`))
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
  assert.match(publicLocation, /\.limit\(1\)/)
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
  assert.match(publicLocation, /from\('location_host_links'\)/)
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

test('the live PR gate load-tests every critical production read path with bounded concurrency', async () => {
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
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /tests\/live\/production-load\.spec\.mjs/)
})
