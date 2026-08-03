import {
  detailObjectKey,
  lonLatToTile,
  mediaOverlayObjectKey,
  packStaticDetail,
  packStaticPlace,
  tileObjectKey
} from '../../lib/app/static-catalogue.js'
import { staticCatalogueLocationId } from '../../lib/app/static-catalogue-id.js'

export const R2_FIXTURE_HOST = '127.0.0.1'
export const R2_FIXTURE_PORT = Number(process.env.E2E_R2_PORT || 43110)
export const R2_FIXTURE_BASE_URL = process.env.E2E_R2_BASE_URL || `http://${R2_FIXTURE_HOST}:${R2_FIXTURE_PORT}`
export const R2_FIXTURE_RELEASE = 'e2e-static-v2'
export const R2_FIXTURE_ZOOM = 10

const baseDetails = {
  neighborhood: 'Downtown',
  regionCode: 'ON',
  postalCode: 'M5V 2T6',
  timezone: 'America/Toronto',
  sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
  sourceConfidence: 0.99,
  sourceOperatingStatus: 'open',
  categoryConfidence: 0.99,
  normalizationVersion: 2,
  categoryMappingVersion: 2,
  amenities: [],
  accessibility: {},
  openingHours: {},
  sourceMetadata: { fixture: true }
}

function fixturePlace(sourcePlaceId, name, kind, latitude, longitude, details = {}) {
  return {
    source: 'overture',
    sourcePlaceId,
    name,
    kind,
    latitude,
    longitude,
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    priceLevel: kind === 'restaurant' || kind === 'cafe' ? 2 : null,
    ...baseDetails,
    summary: `Verified E2E details for ${name}.`,
    addressPublic: `${Math.round((latitude - 43.65) * 100000)} Test Street`,
    duplicateGroupKey: `e2e:${sourcePlaceId}`,
    catalogueGroupKey: `overture:${sourcePlaceId}`,
    payloadHash: sourcePlaceId.padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, 'a'),
    ...details
  }
}

export const R2_FIXTURE_PLACES = Object.freeze([
  fixturePlace('e2e-media-photo', 'E2E Media Photo Cafe', 'cafe', 43.65300, -79.38300),
  fixturePlace('e2e-media-google', 'E2E Media Google Museum', 'museum', 43.65305, -79.38305),
  fixturePlace('e2e-media-placeholder', 'E2E Media Placeholder Park', 'park', 43.65310, -79.38310),
  fixturePlace('e2e-pass-alpha', 'E2E Pass Alpha Gallery', 'gallery', 43.65315, -79.38315),
  fixturePlace('e2e-pass-beta', 'E2E Pass Beta Gallery', 'gallery', 43.65320, -79.38320),
  fixturePlace('e2e-save-bistro', 'E2E Save Bistro', 'restaurant', 43.65325, -79.38325, {
    amenities: ['reservations', 'outdoor_seating']
  }),
  fixturePlace('e2e-detail-observatory', 'E2E Detail Observatory', 'scenic_spot', 43.65330, -79.38330, {
    summary: 'A fixture observatory with detail-sidecar data.',
    addressPublic: '77 Sidecar Lane',
    amenities: ['viewpoint', 'wheelchair_accessible'],
    accessibility: { wheelchair_accessible: true, step_free: true },
    openingHours: { monday: '09:00-17:00', friday: '09:00-20:00' },
    websiteUrl: 'https://example.com/e2e-observatory',
    phonePublic: '+1 416 555 0100'
  }),
  fixturePlace('e2e-shared-date-cafe', 'E2E Shared Date Cafe', 'cafe', 43.65335, -79.38335),
  fixturePlace('e2e-shared-date-gallery', 'E2E Shared Date Gallery', 'gallery', 43.65340, -79.38340),
  fixturePlace('e2e-group-arcade', 'E2E Group Arcade', 'activity_venue', 43.65345, -79.38345),
  fixturePlace('e2e-group-park', 'E2E Group Park', 'park', 43.65350, -79.38350),
  fixturePlace('e2e-failure-cafe', 'E2E Failure Recovery Cafe', 'cafe', 43.65355, -79.38355)
])

export const R2_FIXTURE_BY_SOURCE_ID = new Map(R2_FIXTURE_PLACES.map((place) => [place.sourcePlaceId, place]))
export const R2_FIXTURE_IDS = Object.freeze(Object.fromEntries(
  R2_FIXTURE_PLACES.map((place) => [place.sourcePlaceId, staticCatalogueLocationId(place.source, place.sourcePlaceId)])
))

const tiles = new Map()
for (const place of R2_FIXTURE_PLACES) {
  const tile = lonLatToTile(place.longitude, place.latitude, R2_FIXTURE_ZOOM)
  const key = `${tile.z}/${tile.x}/${tile.y}`
  if (!tiles.has(key)) tiles.set(key, { tile, places: [] })
  tiles.get(key).places.push(place)
}

export const R2_FIXTURE_CENTER_TILE = lonLatToTile(-79.3832, 43.6532, R2_FIXTURE_ZOOM)

export const R2_FIXTURE_OBJECTS = new Map()
for (const { tile, places } of tiles.values()) {
  R2_FIXTURE_OBJECTS.set(`/${tileObjectKey(R2_FIXTURE_RELEASE, tile)}`, {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ v: 2, p: places.map((place) => packStaticPlace(place)) })
  })
  R2_FIXTURE_OBJECTS.set(`/${detailObjectKey(R2_FIXTURE_RELEASE, tile)}`, {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ v: 2, d: places.map((place) => packStaticDetail(place)) })
  })

  const media = []
  for (const place of places) {
    const id = staticCatalogueLocationId(place.source, place.sourcePlaceId)
    if (place.sourcePlaceId === 'e2e-media-photo') {
      media.push([
        id,
        `${R2_FIXTURE_BASE_URL}/photos/e2e-media.png`,
        'wikimedia-commons',
        'E2E Fixture · CC0',
        'https://example.com/e2e-photo-attribution',
        'CC0-1.0',
        null,
        null
      ])
    } else if (place.sourcePlaceId === 'e2e-media-google') {
      media.push([id, null, null, null, null, null, 'e2e-google-place-id', 0.98])
    }
  }
  R2_FIXTURE_OBJECTS.set(`/${mediaOverlayObjectKey(tile)}`, {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ v: 1, m: media })
  })
}

R2_FIXTURE_OBJECTS.set('/catalogue/manifest.json', {
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({
    schema: 2,
    release: R2_FIXTURE_RELEASE,
    source: 'overture',
    zoom: R2_FIXTURE_ZOOM,
    builtAt: '2026-08-03T00:00:00.000Z',
    places: R2_FIXTURE_PLACES.length,
    tileCount: tiles.size,
    placeholdersPrefix: 'catalogue/placeholders',
    mediaPrefix: 'catalogue/media/v1'
  })
})

export function fixturePlaceBySourceId(sourcePlaceId) {
  const place = R2_FIXTURE_BY_SOURCE_ID.get(sourcePlaceId)
  if (!place) throw new Error(`Unknown R2 E2E fixture place ${sourcePlaceId}.`)
  return {
    ...place,
    id: staticCatalogueLocationId(place.source, place.sourcePlaceId)
  }
}
