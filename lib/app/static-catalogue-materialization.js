import { createHash } from 'node:crypto'
import { openPlaceRpcPayload } from './open-place-catalogue.js'
import { fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'

function boundedRadius(value) {
  const parsed = Number(value)
  return Math.max(1, Math.min(100, Number.isFinite(parsed) ? parsed : 100))
}

export function staticCatalogueLocationId(source, sourcePlaceId) {
  const digest = createHash('sha256').update(`${String(source || '').trim()}:${String(sourcePlaceId || '').trim()}`).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function staticMaterializedSlug(place, locationId = staticCatalogueLocationId(place?.source, place?.sourcePlaceId)) {
  const base = String(place?.slug || place?.name || 'place')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 82) || 'place'
  return `${base}-${String(locationId).replaceAll('-', '').slice(0, 12)}`.slice(0, 100)
}

async function existingLocationIds(admin, ids) {
  if (!ids.length) return new Set()
  const result = await admin.from('locations').select('id').in('id', ids)
  if (result.error) throw result.error
  return new Set((result.data || []).map((row) => row.id))
}

export async function materializeStaticCatalogueLocations({
  admin,
  latitude,
  longitude,
  radiusKm = 100,
  locationIds = [],
  baseUrl = staticCatalogueBaseUrl()
} = {}) {
  const requested = [...new Set(locationIds.map(String))]
  if (!requested.length) return { materialized: new Map(), missing: [] }
  if (!admin) throw new Error('An administrative Supabase client is required.')
  if (!baseUrl || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return { materialized: new Map(), missing: requested }
  }

  const existing = await existingLocationIds(admin, requested)
  const unresolved = requested.filter((id) => !existing.has(id))
  const materialized = new Map([...existing].map((id) => [id, { id, existing: true }]))
  if (!unresolved.length) return { materialized, missing: [] }

  const nearby = await fetchNearbyStaticPlaces({
    latitude: Number(latitude),
    longitude: Number(longitude),
    radiusKm: boundedRadius(radiusKm),
    limit: 500,
    baseUrl
  })
  const byId = new Map(nearby.places.map((place) => [staticCatalogueLocationId(place.source, place.sourcePlaceId), place]))

  for (const id of unresolved) {
    const place = byId.get(id)
    if (!place || !['overture', 'fsq_os'].includes(place.source)) continue
    const normalized = { ...place, slug: staticMaterializedSlug(place, id) }
    const payload = openPlaceRpcPayload(normalized, {
      releaseId: nearby.manifest?.release || null,
      regionId: null
    })
    const result = await admin.rpc('materialize_static_catalogue_location_v1', {
      target_location: id,
      import_source: place.source,
      payload
    })
    if (result.error) throw result.error
    materialized.set(id, { id: result.data || id, place: normalized, existing: false })
  }

  return {
    materialized,
    missing: requested.filter((id) => !materialized.has(id)),
    release: nearby.manifest?.release || null,
    tilesLoaded: nearby.tilesLoaded
  }
}
