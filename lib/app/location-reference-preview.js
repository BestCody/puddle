import { validCoordinates } from './optional-number.js'
import { normalizeOpenPhotoHash, openPhotoUrlForHash } from '../media/open-photo-url.js'

// Derived presentation metadata for referenced locations, not a second catalogue.
export function locationReferenceMetadata(row) {
  const coordinates = validCoordinates(row.latitude, row.longitude)
  return {
    location_id: row.id,
    name: String(row.name || '').slice(0, 300),
    slug: String(row.slug || '').slice(0, 400),
    category: String(row.category || row.kind || 'other').slice(0, 80),
    city: String(row.city || '').slice(0, 160),
    summary: String(row.summary || row.description || '').slice(0, 1000) || null,
    neighborhood: String(row.neighborhood || '').slice(0, 160) || null,
    is_published: row.status === 'published',
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    photo_hash: normalizeOpenPhotoHash(row.primary_photo?.content_hash)
  }
}

export function savedLocationOption(row) {
  return {
    id: row.location_id,
    name: row.name,
    title: row.name,
    slug: row.slug,
    city: row.city,
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
    cover_url: openPhotoUrlForHash(row.photo_hash)
  }
}
