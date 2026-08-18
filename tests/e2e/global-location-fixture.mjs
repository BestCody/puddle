export const GLOBAL_LOCATION_FIXTURES = Object.freeze([
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'moonlight-cafe',
    name: 'Moonlight Café',
    summary: 'Late-night coffee, pastries, and a relaxed downtown atmosphere.',
    description: 'A warm Toronto café fixture used by the end-to-end product suite.',
    category: 'cafe',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Downtown',
    address: '101 Test Street',
    latitude: 43.65315,
    longitude: -79.38315,
    timezone: 'America/Toronto',
    price_level: 2
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'sunset-steps',
    name: 'Sunset Steps',
    summary: 'A waterfront lookout for sunsets and skyline views.',
    description: 'A scenic Toronto fixture used by the end-to-end product suite.',
    category: 'scenic_spot',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Harbourfront',
    address: '102 Test Street',
    latitude: 43.6388,
    longitude: -79.3819,
    timezone: 'America/Toronto',
    price_level: null
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'laneway-gallery',
    name: 'Laneway Gallery',
    summary: 'A small contemporary gallery tucked into a downtown laneway.',
    description: 'An arts fixture used by the end-to-end product suite.',
    category: 'gallery',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Downtown',
    address: '103 Test Street',
    latitude: 43.6542,
    longitude: -79.3861,
    timezone: 'America/Toronto',
    price_level: 1
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'harbour-activity-deck',
    name: 'Harbour Activity Deck',
    summary: 'An outdoor activity space beside Toronto’s waterfront.',
    description: 'An activity fixture used by the end-to-end product suite.',
    category: 'activity_venue',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Harbourfront',
    address: '104 Test Street',
    latitude: 43.6396,
    longitude: -79.3787,
    timezone: 'America/Toronto',
    price_level: 2
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    slug: 'riverside-park',
    name: 'Riverside Park',
    summary: 'A green riverside park for walks, picnics, and quiet afternoons.',
    description: 'A park fixture used by the end-to-end product suite.',
    category: 'park',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Riverside',
    address: '105 Test Street',
    latitude: 43.6625,
    longitude: -79.3492,
    timezone: 'America/Toronto',
    price_level: null
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'market-hall',
    name: 'Market Hall',
    summary: 'Local food counters and shops gathered in a lively market hall.',
    description: 'A market fixture used by the end-to-end product suite.',
    category: 'restaurant',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Toronto',
    neighborhood: 'Old Town',
    address: '106 Test Street',
    latitude: 43.6487,
    longitude: -79.3715,
    timezone: 'America/Toronto',
    price_level: 2
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    slug: 'figma-maple-grove-park',
    name: 'Maple Grove Park',
    summary: 'A quiet Oakville park made for picnics and long afternoons.',
    description: 'A quiet Oakville park made for picnics and long afternoons.',
    category: 'park',
    country: 'Canada',
    country_code: 'CA',
    region: 'Ontario',
    city: 'Oakville',
    neighborhood: 'Oakville',
    address: '107 Test Street',
    latitude: 43.4675,
    longitude: -79.6877,
    timezone: 'America/Toronto',
    price_level: null
  }
].map((place) => Object.freeze({
  ...place,
  status: 'published',
  quality_score: 0.9,
  popularity_score: 10,
  opening_hours: {},
  amenities: [],
  accessibility: {},
  accessible: false,
  primary_photo: null,
  google_place_id: null,
  updated_at: '2026-08-18T00:00:00.000Z'
})))

export const GLOBAL_LOCATION_FIXTURE_BY_SLUG = new Map(
  GLOBAL_LOCATION_FIXTURES.map((place) => [place.slug, place])
)

export const GLOBAL_LOCATION_FIXTURE_BY_ID = new Map(
  GLOBAL_LOCATION_FIXTURES.map((place) => [place.id, place])
)

export function globalLocationFixtureBySlug(slug) {
  const place = GLOBAL_LOCATION_FIXTURE_BY_SLUG.get(String(slug))
  if (!place) throw new Error(`Unknown OpenSearch E2E fixture slug ${slug}.`)
  return { ...place }
}
