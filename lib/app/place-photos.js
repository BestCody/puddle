const SOURCE_PRIORITY = Object.freeze({
  venue: 0,
  puddle_user: 1,
  provider: 2,
  licensed_public: 3
})

function safeText(value, max = 240) {
  return String(value || '').trim().slice(0, max)
}

export function supabasePhotoHost(value = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

export function allowedPhotoHosts(
  value = process.env.LOCATION_PHOTO_ALLOWED_HOSTS,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
) {
  const hosts = new Set(String(value || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
  const projectHost = supabasePhotoHost(supabaseUrl)
  if (projectHost) hosts.add(projectHost)
  return hosts
}

export function approvedPhotoUrl(value, hosts = allowedPhotoHosts()) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:') return null
    if (!hosts.size || !hosts.has(url.hostname.toLowerCase())) return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export function chooseLocationPhoto(rows = [], now = new Date()) {
  const currentTime = now.getTime()
  return rows
    .filter((row) => row?.status === 'approved' && row?.is_ai_generated !== true)
    .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > currentTime)
    .sort((a, b) => {
      const primary = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
      if (primary) return primary
      const source = (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99)
      if (source) return source
      const order = Number(a.sort_order || 0) - Number(b.sort_order || 0)
      if (order) return order
      return new Date(b.verified_at || 0).getTime() - new Date(a.verified_at || 0).getTime()
    })[0] || null
}

export function photoMetadata(row) {
  if (!row) return null
  return {
    id: row.id,
    source: safeText(row.source, 40),
    provider: safeText(row.provider, 80),
    attribution: safeText(row.attribution_text, 240) || null,
    attributionUrl: safeText(row.attribution_url, 500) || null,
    license: safeText(row.license_code, 80) || null,
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null
  }
}

export function providerPhotoPath(photoId) {
  return photoId ? `/api/location-photos/${encodeURIComponent(String(photoId))}` : null
}
