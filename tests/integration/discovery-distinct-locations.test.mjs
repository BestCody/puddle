import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getRelationalDiscoveryFeed } from '../../lib/app/discovery-relational.js'

function location(id, name, group, latitude = 43.65, longitude = -79.38) {
  return {
    id,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    name,
    summary: null,
    kind: 'cafe',
    timezone: 'America/Toronto',
    timezone_verified: true,
    price_level: 2,
    accessibility: {},
    amenities: [],
    opening_hours: {},
    latitude,
    longitude,
    neighborhood: null,
    city: 'Toronto',
    region: 'Ontario',
    region_code: 'ON',
    country: 'Canada',
    country_code: 'CA',
    postal_code: null,
    address_public: null,
    brand_id: null,
    brand_name: null,
    source_parent_place_id: null,
    duplicate_group_key: group,
    catalogue_group_key: null,
    cover_path: null,
    source: 'import',
    published_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    google_place_id: null,
    google_place_match_score: null,
    photo_url: null,
    photo_provider: null,
    photo_attribution: null,
    photo_attribution_url: null,
    photo_license: null,
    distance_m: 100
  }
}

function duplicateKey(row) {
  if (row.duplicate_group_key) return `duplicate:${row.duplicate_group_key}`
  if (row.catalogue_group_key) return `catalogue:${row.catalogue_group_key}`
  return `fallback:${String(row.name || '').toLowerCase()}:${Number(row.latitude).toFixed(4)}:${Number(row.longitude).toFixed(4)}`
}

function session(locations, seen = []) {
  return {
    user: { id: 'user-1' },
    profile: {
      latitude: 43.65,
      longitude: -79.38,
      search_radius_km: 25,
      interests: ['cafe'],
      city: 'Toronto'
    },
    supabase: {
      rpc(name, args = {}) {
        if (name === 'r2_discovery_overlay_v2') {
          const excludedIds = new Set((args.exclude_ids || []).map(String))
          const excludedGroups = new Set(seen.map(duplicateKey))
          for (const row of locations) if (excludedIds.has(String(row.id))) excludedGroups.add(duplicateKey(row))
          const filtered = locations.filter((row) =>
            !excludedIds.has(String(row.id)) &&
            !excludedGroups.has(duplicateKey(row)) &&
            (!args.category_filter || row.kind === args.category_filter) &&
            (args.price_filter == null || Number(row.price_level) === Number(args.price_filter))
          )
          return Promise.resolve({ data: { interests: [], locations: filtered }, error: null })
        }
        throw new Error(`Unexpected RPC: ${name}`)
      },
      storage: {
        from() {
          return { getPublicUrl: () => ({ data: { publicUrl: null } }) }
        }
      }
    }
  }
}

test('previously swiped locations and physical duplicate siblings stay out of discovery', async () => {
  const first = location('00000000-0000-4000-8000-000000000001', 'Same Cafe', 'same-cafe')
  const duplicate = location('00000000-0000-4000-8000-000000000002', 'Same Cafe', 'same-cafe', 43.65001, -79.38001)
  const distinct = location('00000000-0000-4000-8000-000000000003', 'Different Cafe', 'different-cafe')
  const seen = [{
    id: first.id,
    duplicate_group_key: first.duplicate_group_key,
    catalogue_group_key: null,
    name: first.name,
    latitude: first.latitude,
    longitude: first.longitude
  }]

  const feed = await getRelationalDiscoveryFeed(session([first, duplicate, distinct], seen), { limit: 12 })

  assert.deepEqual(feed.items.map((item) => item.content_id), [distinct.id])
  assert.equal(feed.items.some((item) => item.title === 'Same Cafe'), false)
})

test('continuation exclusions remove every row in the same physical duplicate group', async () => {
  const first = location('00000000-0000-4000-8000-000000000011', 'Batch Cafe', 'batch-cafe')
  const duplicate = location('00000000-0000-4000-8000-000000000012', 'Batch Cafe', 'batch-cafe', 43.65002, -79.38002)
  const distinct = location('00000000-0000-4000-8000-000000000013', 'Next Cafe', 'next-cafe')

  const feed = await getRelationalDiscoveryFeed(
    session([first, duplicate, distinct]),
    { limit: 12 },
    { excludeIds: [first.id] }
  )

  assert.deepEqual(feed.items.map((item) => item.content_id), [distinct.id])
})

test('installed seen-location runtime tracks relational swipe state only', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/10050_relational_discovery_runtime.sql', import.meta.url), 'utf8')
  assert.match(migration, /discovery_seen_locations_v1/)
  assert.match(migration, /action\.action in \('saved','interested','dismissed','visited'\)/)
  assert.doesNotMatch(migration, /action\.action in \([^)]*'opened'/)
  assert.match(migration, /order by action\.location_id,action\.id desc/)
  assert.match(migration, /latest\.undone_at is null/)
  assert.doesNotMatch(migration, /static_catalogue_actions/)
})

test('new overlay has no materialization gate and applies filters before its page limit', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/10061_discovery_unbounded_pagination.sql', import.meta.url), 'utf8')
  assert.match(migration, /r2_discovery_overlay_v2/)
  assert.match(migration, /st_dwithin\(location\.point,center_point,safe_radius\)/)
  assert.match(migration, /category_filter/)
  assert.match(migration, /price_filter/)
  assert.match(migration, /amenity_filter/)
  assert.match(migration, /accessible_only/)
  assert.match(migration, /open_now_only/)
  assert.ok(migration.indexOf('category_filter') < migration.lastIndexOf('limit safe_limit'))
  assert.doesNotMatch(migration, /static_catalogue_materializations/)
  assert.doesNotMatch(migration, /least\(100000,/)
})

test('continuation is not capped by a historical session-id ceiling', async () => {
  const [workspace, route, relational] = await Promise.all([
    readFile(new URL('../../components/date-swipe-workspace-v2.js', import.meta.url), 'utf8'),
    readFile(new URL('../../app/api/discovery/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/app/discovery-relational.js', import.meta.url), 'utf8')
  ])
  assert.doesNotMatch(workspace, /MAX_CONTINUATION_EXCLUDES/)
  assert.doesNotMatch(workspace, /sessionIds\.current\.size\s*>=/)
  assert.doesNotMatch(route, /MAX_CONTINUATION_EXCLUDES/)
  assert.match(workspace, /await drainActions\(\)/)
  assert.match(workspace, /visibleIds/)
  assert.match(relational, /r2_discovery_overlay_v2/)
  assert.doesNotMatch(relational, /PRIMARY_QUERY_LIMIT/)
})
