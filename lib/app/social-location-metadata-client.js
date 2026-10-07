const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const METADATA_TTL_MS = 60_000
const METADATA_CACHE_LIMIT = 256
const metadataCache = new Map()
const metadataInFlight = new Map()

function locationIdForRow(row, key) {
  if (key === 'last_location_id') return row?.last_location_id || null
  if (row?.location_id) return row.location_id
  if (row?.message_type !== 'location') return null
  const candidate = row?.metadata?.locationId
  return UUID_PATTERN.test(String(candidate || '')) ? candidate : null
}

async function fetchMetadataBatch(ids) {
  const response = await fetch(`/api/social/location-metadata?ids=${encodeURIComponent(ids.join(','))}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.items)) {
    throw new Error(payload?.error || 'Location metadata could not be loaded.')
  }
  return new Map(payload.items.map((item) => [String(item.id), item]))
}

function rememberMetadata(id, value) {
  metadataCache.delete(id)
  metadataCache.set(id, { value, expiresAt: Date.now() + METADATA_TTL_MS })
  while (metadataCache.size > METADATA_CACHE_LIMIT) metadataCache.delete(metadataCache.keys().next().value)
}

export async function fetchSocialLocationMetadata(ids) {
  const unique = [...new Set((ids || []).map((value) => String(value || '').trim()).filter((value) => UUID_PATTERN.test(value)))]
  if (!unique.length) return new Map()

  const resolved = new Map()
  const pending = []
  const missing = []
  for (const id of unique) {
    const cached = metadataCache.get(id)
    if (cached && cached.expiresAt > Date.now()) {
      metadataCache.delete(id)
      metadataCache.set(id, cached)
      resolved.set(id, cached.value)
    } else {
      if (cached) metadataCache.delete(id)
      const active = metadataInFlight.get(id)
      if (active) pending.push([id, active])
      else missing.push(id)
    }
  }

  if (missing.length) {
    // All misses in this render share one authenticated request. Other renders
    // can reuse each pending ID, even when their batches only partly overlap.
    const batch = fetchMetadataBatch(missing)
    for (const id of missing) {
      const request = batch.then((rows) => {
        const value = rows.get(id) || null
        if (value) rememberMetadata(id, value)
        return value
      }).finally(() => {
        if (metadataInFlight.get(id) === request) metadataInFlight.delete(id)
      })
      metadataInFlight.set(id, request)
      pending.push([id, request])
    }
  }

  const values = await Promise.all(pending.map(async ([id, request]) => [id, await request]))
  for (const [id, value] of values) if (value) resolved.set(id, value)
  return resolved
}

export async function hydrateSocialLocationRows(rows, key) {
  const source = Array.isArray(rows) ? rows : []
  const ids = source.map((row) => locationIdForRow(row, key)).filter(Boolean)
  const metadata = await fetchSocialLocationMetadata(ids)
  return source.map((row) => {
    const locationId = locationIdForRow(row, key)
    const place = locationId ? metadata.get(String(locationId)) : null
    if (key === 'last_location_id') {
      return {
        ...row,
        last_location_id: locationId || null,
        last_location_name: place?.name || null,
        last_location_city: place?.city || null,
        last_location_slug: place?.slug || null,
        last_location_cover_path: place?.cover_path || null
      }
    }
    return {
      ...row,
      location_id: locationId || null,
      location_name: place?.name || null,
      location_city: place?.city || null,
      location_slug: place?.slug || null,
      location_cover_path: place?.cover_path || null
    }
  })
}
