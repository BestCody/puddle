const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function locationIdForRow(row, key) {
  if (key === 'last_location_id') return row?.last_location_id || null
  if (row?.location_id) return row.location_id
  if (row?.message_type !== 'location') return null
  const candidate = row?.metadata?.locationId
  return UUID_PATTERN.test(String(candidate || '')) ? candidate : null
}

export async function fetchSocialLocationMetadata(ids) {
  const unique = [...new Set((ids || []).map((value) => String(value || '').trim()).filter((value) => UUID_PATTERN.test(value)))]
  if (!unique.length) return new Map()

  const response = await fetch(`/api/social/location-metadata?ids=${encodeURIComponent(unique.join(','))}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' }
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload?.items)) {
    throw new Error(payload?.error || 'Location metadata could not be loaded.')
  }
  return new Map(payload.items.map((item) => [String(item.id), item]))
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
