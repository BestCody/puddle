import {
  CATALOGUE_CATEGORY_MAPPING_VERSION,
  CATALOGUE_NORMALIZATION_VERSION,
  openPlaceRpcPayload
} from './open-place-catalogue.js'
import { fetchStaticPlacesByReferences, staticCatalogueBaseUrl } from './static-catalogue.js'
import { staticCatalogueLocationId, staticMaterializedSlug } from './static-catalogue-id.js'
import { verifyStaticCatalogueReference } from './static-catalogue-ref.js'

export { staticCatalogueLocationId, staticMaterializedSlug }

async function existingLocationIds(admin, ids) {
  if (!ids.length) return new Set()
  const rows = []
  for (let index = 0; index < ids.length; index += 200) {
    const result = await admin.from('locations').select('id').in('id', ids.slice(index, index + 200))
    if (result.error) throw result.error
    rows.push(...(result.data || []))
  }
  return new Set(rows.map((row) => row.id))
}

function referenceEntries(references = []) {
  if (Array.isArray(references)) {
    return references.flatMap((entry) => {
      if (typeof entry === 'string') return []
      const id = String(entry?.id || '')
      const token = String(entry?.token || entry?.ref || '')
      return id && token ? [[id, token]] : []
    })
  }
  if (references && typeof references === 'object') {
    return Object.entries(references).flatMap(([id, token]) => id && token ? [[String(id), String(token)]] : [])
  }
  return []
}

function validPriceLevel(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : null
}

export function verifiedStaticReference(token, expectedId) {
  return verifyStaticCatalogueReference(token, { expectedId })
}

export async function materializeStaticCatalogueReferences({
  admin,
  locationIds = [],
  references = [],
  baseUrl = staticCatalogueBaseUrl()
} = {}) {
  const requested = [...new Set(locationIds.map(String))].slice(0, 50)
  if (!requested.length) return { materialized: new Map(), missing: [] }
  if (!admin) throw new Error('An administrative Supabase client is required.')

  const existing = await existingLocationIds(admin, requested)
  const materialized = new Map([...existing].map((id) => [id, { id, existing: true }]))
  const referenceMap = new Map(referenceEntries(references))
  const unresolved = requested.filter((id) => !existing.has(id))
  const verified = []

  for (const id of unresolved) {
    const token = referenceMap.get(id)
    if (!token || !baseUrl) continue
    try {
      verified.push(verifyStaticCatalogueReference(token, { expectedId: id }))
    } catch {
      // Invalid or expired references stay in the missing result.
    }
  }

  const places = await fetchStaticPlacesByReferences(verified, { baseUrl })
  const payloadItems = []
  const normalizedById = new Map()
  for (const reference of verified) {
    const place = places.get(reference.id)
    if (!place || !['overture', 'fsq_os'].includes(place.source)) continue
    const normalized = {
      ...place,
      priceLevel: validPriceLevel(place.priceLevel),
      slug: staticMaterializedSlug(place, reference.id),
      normalizationVersion: CATALOGUE_NORMALIZATION_VERSION,
      categoryMappingVersion: CATALOGUE_CATEGORY_MAPPING_VERSION,
      sourceMetadata: {}
    }
    normalizedById.set(reference.id, normalized)
    payloadItems.push({
      targetLocation: reference.id,
      source: place.source,
      payload: openPlaceRpcPayload(normalized, { releaseId: reference.release, regionId: null })
    })
  }

  if (payloadItems.length) {
    const result = await admin.rpc('materialize_static_catalogue_locations_v2', { items: payloadItems })
    if (result.error) throw result.error
    for (const row of result.data || []) {
      const requestedId = String(row.requestedId || row.requested_id || '')
      const mappedId = String(row.locationId || row.location_id || requestedId)
      if (!requestedId) continue
      materialized.set(requestedId, {
        id: mappedId,
        place: normalizedById.get(requestedId) || null,
        existing: false
      })
    }
  }

  return {
    materialized,
    missing: requested.filter((id) => !materialized.has(id))
  }
}

export async function materializeStaticCatalogueLocations(options = {}) {
  return materializeStaticCatalogueReferences(options)
}
