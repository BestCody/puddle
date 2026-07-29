function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function extractCoordinates(payload) {
  const candidate = payload?.features?.[0] || payload?.results?.[0] || payload?.data?.[0] || payload?.[0]
  if (!candidate) return null
  const coordinates = candidate.geometry?.coordinates
  const longitude = number(coordinates?.[0] ?? candidate.longitude ?? candidate.lon ?? candidate.lng)
  const latitude = number(coordinates?.[1] ?? candidate.latitude ?? candidate.lat)
  if (latitude === null || longitude === null) return null
  return {
    latitude,
    longitude,
    label: candidate.properties?.label || candidate.place_name || candidate.display_name || candidate.formatted || null,
    providerId: candidate.id || candidate.place_id || null,
    raw: candidate
  }
}

export function geocodingConfigured() {
  return Boolean(process.env.GEOCODING_PROVIDER_URL)
}

export async function geocodeAddress(address, { signal } = {}) {
  const query = String(address || '').trim().slice(0, 400)
  if (query.length < 4) throw new Error('Enter a more complete address or place name.')
  if (!geocodingConfigured()) return { configured: false, result: null }

  const url = new URL(process.env.GEOCODING_PROVIDER_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '1')
  if (process.env.GEOCODING_API_KEY) url.searchParams.set('key', process.env.GEOCODING_API_KEY)

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Puddle/1.0 location editor' },
    signal,
    cache: 'no-store'
  })
  if (!response.ok) throw new Error('The map provider could not find that address.')
  const payload = await response.json()
  return { configured: true, result: extractCoordinates(payload) }
}
