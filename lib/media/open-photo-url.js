const OPEN_PHOTO_HASH_RE = /^[0-9a-f]{64}$/

export function normalizeOpenPhotoHash(value) {
  const hash = String(value || '').trim().toLowerCase()
  return OPEN_PHOTO_HASH_RE.test(hash) ? hash : null
}

export function openPhotoUrlForHash(value) {
  const hash = normalizeOpenPhotoHash(value)
  return hash ? `/api/open-photo/${hash}` : null
}
