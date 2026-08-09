import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getRelationalDiscoveryFeed } from '../../lib/app/discovery-relational-fallback.js'

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
      rpc(name) {
        if (name === 'r2_discovery_overlay_v1') {
          return Promise.resolve({ data: { dismissedIds: [], interests: [], locations }, error: null })
        }
        if (name === 'discovery_seen_locations_v1') return Promise.resolve({ data: seen, error: null })
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

test('seen-location RPC tracks completed swipe actions but not detail opens', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/10048_distinct_discovery_locations.sql', import.meta.url), 'utf8')
  assert.match(migration, /discovery_seen_locations_v1/)
  assert.match(migration, /action\.action in \('saved','interested','dismissed','visited'\)/)
  assert.doesNotMatch(migration, /action\.action in \([^)]*'opened'/)
  assert.match(migration, /order by action\.location_id,action\.id desc/)
  assert.match(migration, /latest\.undone_at is null/)
  assert.match(migration, /static_catalogue_actions/)
})
