import { openPhotoUrlForHash } from '../media/open-photo-url.js'

// This is a presentation projection, not an authoritative detail/writes reader.
// Missing or moderated references stay missing; never fall back to full shards.
export async function getLocationPreviews(supabase, ids = []) {
  const requested = [...new Set(ids.filter(Boolean).map(String))]
  if (!requested.length) return []
  if (requested.length > 100) throw new RangeError('Location preview batches are limited to 100 places.')
  const { data, error } = await supabase.rpc('location_previews_v1', { requested_ids: requested })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Location previews returned an invalid response.')
  const byId = new Map(data.map(row => [row.location_id, {
    id: row.location_id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    summary: row.summary,
    neighborhood: row.neighborhood,
    cover_path: openPhotoUrlForHash(row.photo_hash)
  }]))
  return requested.map(id => byId.get(id)).filter(Boolean)
}
