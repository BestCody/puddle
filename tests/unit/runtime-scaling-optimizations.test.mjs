import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  clearStaticCandidateCacheForTests,
  fetchCachedNearbyStaticPlaces,
  staticCandidateCacheKey
} from '../../lib/app/static-candidate-cache.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('candidate pools coalesce concurrent and repeated nearby requests', async () => {
  clearStaticCandidateCacheForTests()
  let calls = 0
  const options = { latitude: 43.45164, longitude: -79.68291, radiusKm: 10, limit: 96, baseUrl: 'https://catalogue.example' }
  const loader = async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { places: [{ contentId: 'one' }], manifest: { release: 'r1' }, tilesLoaded: 1, tilesRequested: 1 }
  }
  const [first, concurrent] = await Promise.all([
    fetchCachedNearbyStaticPlaces(options, { loader, ttlMs: 5_000, now: 1_000 }),
    fetchCachedNearbyStaticPlaces(options, { loader, ttlMs: 5_000, now: 1_000 })
  ])
  const repeated = await fetchCachedNearbyStaticPlaces(options, { loader, ttlMs: 5_000, now: 1_100 })
  assert.equal(calls, 1)
  assert.equal(first.candidateCache.status, 'miss')
  assert.equal(concurrent.candidateCache.status, 'hit')
  assert.equal(repeated.candidateCache.status, 'hit')
})

test('candidate cache keys preserve exact distance calculations', () => {
  const base = { latitude: 43.451611, longitude: -79.68291, radiusKm: 10, limit: 96, baseUrl: 'https://catalogue.example' }
  assert.equal(staticCandidateCacheKey(base), staticCandidateCacheKey({ ...base, latitude: 43.451614 }))
  assert.notEqual(staticCandidateCacheKey(base), staticCandidateCacheKey({ ...base, latitude: 43.453 }))
})

test('runtime scaling surfaces use realtime, one-RPC snapshots, outbox work, and measured cache timings', async () => {
  const workspace = await read('components/date-match-workspace-realtime.js')
  const snapshot = await read('lib/app/date-match-snapshot.js')
  const discovery = await read('lib/app/discovery-infrastructure-v2.js')
  const actionRoute = await read('app/api/discovery/actions/route.js')
  const card = await read('components/minimal-swipe-card.js')
  const realtimeMigration = await read('supabase/migrations/10029_date_match_realtime_snapshot.sql')
  const actionMigration = await read('supabase/migrations/10031_discovery_actions_v4.sql')
  const outboxMigration = await read('supabase/migrations/10032_process_discovery_context_outbox.sql')
  const spatialMigration = await read('supabase/migrations/10033_discovery_spatial_profile.sql')

  assert.ok(workspace.includes("table: 'date_match_room_versions'"))
  assert.ok(workspace.includes('90_000'))
  assert.equal(workspace.includes('setInterval(refreshRoom, 7000)'), false)
  assert.ok(snapshot.includes("rpc('get_date_match_snapshot_v2'"))
  assert.ok(discovery.includes('fetchCachedNearbyStaticPlaces'))
  assert.ok(discovery.includes('overlayMs'))
  assert.ok(actionRoute.includes("rpc('record_discovery_actions_v4'"))
  assert.ok(actionRoute.includes("rpc('process_discovery_context_outbox_v1'"))
  assert.ok(card.includes('item.static_catalogue_ephemeral'))
  assert.ok(card.includes("['pending', 'processing', 'failed'].includes(nextStatus)"))
  assert.ok(realtimeMigration.includes('get_date_match_snapshot_v2'))
  assert.ok(actionMigration.includes('jsonb_to_recordset(actions)'))
  assert.ok(actionMigration.includes('record_discovery_actions_v3(actions)'))
  assert.ok(outboxMigration.includes('discovery_context_claims'))
  assert.ok(spatialMigration.includes('discovery_spatial_profile_v1'))
  assert.ok(spatialMigration.includes("'recommendPostgis'"))
})
