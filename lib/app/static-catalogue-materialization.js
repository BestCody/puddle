import { openPlaceRpcPayload } from './open-place-catalogue.js'
import { fetchStaticPlaceByReference, staticCatalogueBaseUrl } from './static-catalogue.js'
import { staticCatalogueLocationId, staticMaterializedSlug } from './static-catalogue-id.js'
import { verifyStaticCatalogueReference } from './static-catalogue-ref.js'

export { staticCatalogueLocationId, staticMaterializedSlug }

async function existingLocationIds(admin, ids) {
  if (!ids.length) return new Set()
  const result = await admin.from('locations').select('id').in('id', ids)
  if (result.error) throw result.error
  return new Set((result.data || []).map((row) => row.id))
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

export function verifiedStaticReference(token, expectedId) {
  return verifyStaticCatalogueReference(token, { expectedId })
}

export async function materializeStaticCatalogueReferences({
  admin,
  locationIds = [],
  references = [],
  baseUrl = staticCatalogueBaseUrl()
} = {}) {
  const requested = [...new Set(locationIds.map(String))]
  if (!requested.length) return { materialized: new Map(), missing: [] }
  if (!admin) throw new Error('An administrative Supabase client is required.')

  const existing = await existingLocationIds(admin, requested)
  const materialized = new Map([...existing].map((id) => [id, { id, existing: true }]))
  const referenceMap = new Map(referenceEntries(references))
  const unresolved = requested.filter((id) => !existing.has(id))

  for (const id of unresolved) {
    const token = referenceMap.get(id)
    if (!token || !baseUrl) continue
    const reference = verifyStaticCatalogueReference(token, { expectedId: id })
    const place = await fetchStaticPlaceByReference(reference, { baseUrl })
    if (!place || !['overture', 'fsq_os'].includes(place.source)) continue
    const normalized = { ...place, slug: staticMaterializedSlug(place, id) }
    const payload = openPlaceRpcPayload(normalized, {
      releaseId: reference.release,
      regionId: null
    })
    const result = await admin.rpc('materialize_static_catalogue_location_v1', {
      target_location: id,
      import_source: place.source,
      payload
    })
    if (result.error) throw result.error
    const mappedId = String(result.data || id)
    materialized.set(id, { id: mappedId, place: normalized, existing: false })
  }

  return {
    materialized,
    missing: requested.filter((id) => !materialized.has(id))
  }
}

export async function materializeStaticCatalogueLocations(options = {}) {
  return materializeStaticCatalogueReferences(options)
}
