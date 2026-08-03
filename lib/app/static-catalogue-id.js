import { createHash } from 'node:crypto'

export function staticCatalogueLocationId(source, sourcePlaceId) {
  const digest = createHash('sha256')
    .update(`${String(source || '').trim()}:${String(sourcePlaceId || '').trim()}`)
    .digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function staticMaterializedSlug(place, locationId = staticCatalogueLocationId(place?.source, place?.sourcePlaceId)) {
  const base = String(place?.name || 'place')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 82) || 'place'
  return `${base}-${String(locationId).replaceAll('-', '').slice(0, 12)}`.slice(0, 100)
}
