import { admin } from './support.mjs'

const baseDetails = Object.freeze({
  city: 'Toronto',
  neighborhood: 'Downtown',
  region: 'Ontario',
  country: 'Canada',
  country_code: 'CA',
  timezone: 'America/Toronto',
  source_confidence: 0.99,
  source_updated_at: '2026-08-01T00:00:00.000Z',
  amenities: []
})

function fixturePlace(sourcePlaceId, name, kind, latitude, longitude, details = {}) {
  return Object.freeze({
    source_place_id: sourcePlaceId,
    name,
    slug: sourcePlaceId,
    kind,
    latitude,
    longitude,
    ...baseDetails,
    summary: `Verified E2E details for ${name}.`,
    address_public: `${Math.round((latitude - 43.65) * 100000)} Test Street`,
    payload_hash: sourcePlaceId.padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, 'a'),
    ...details
  })
}

const RELATIONAL_FIXTURE_PLACES = Object.freeze([
  fixturePlace('e2e-pass-alpha', 'E2E Pass Alpha Gallery', 'gallery', 43.65315, -79.38315),
  fixturePlace('e2e-pass-beta', 'E2E Pass Beta Gallery', 'gallery', 43.65320, -79.38320)
])

const RELATIONAL_FIXTURE_BY_SOURCE_ID = new Map(
  RELATIONAL_FIXTURE_PLACES.map((place) => [place.source_place_id, place])
)

export function fixturePlaceBySourceId(sourcePlaceId) {
  const place = RELATIONAL_FIXTURE_BY_SOURCE_ID.get(sourcePlaceId)
  if (!place) throw new Error(`Unknown relational E2E fixture place ${sourcePlaceId}.`)
  return { ...place }
}

export async function ensureRelationalFixturePlaces(places) {
  const payloads = (places || []).map((place) => ({ ...place }))
  if (!payloads.length) throw new Error('Relational E2E fixture places are required.')

  const { data, error } = await admin.rpc('upsert_open_catalogue_batch_v1', {
    import_source: 'overture',
    payloads
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== payloads.length) {
    throw new Error('Supabase did not import the complete relational E2E fixture set.')
  }

  const failures = data.filter((row) => row.error_message || !row.location_id)
  if (failures.length) {
    throw new Error(`Relational E2E fixture import failed: ${failures.map((row) => `${row.source_place_id}: ${row.error_message || 'missing location id'}`).join(' | ')}`)
  }

  return data
}
