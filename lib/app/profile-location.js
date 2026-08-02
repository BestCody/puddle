const LOCATION_SOURCES = new Set(['browser', 'city_search', 'legacy', 'admin'])

function text(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function profileLocationFromForm(formData, fallback = {}) {
  const latitude = number(formData.get('latitude') ?? fallback.latitude)
  const longitude = number(formData.get('longitude') ?? fallback.longitude)
  const city = text(formData.get('city') ?? fallback.city, 120)
  const region = text(formData.get('region') ?? fallback.region, 120) || null
  const country = text(formData.get('country') ?? fallback.country, 120) || null
  const countryCode = text(formData.get('country_code') ?? fallback.country_code, 2).toUpperCase() || null
  const timezone = text(formData.get('timezone') ?? fallback.timezone, 80) || 'UTC'
  const label = text(formData.get('location_label') ?? fallback.location_label, 240) || [city, region, country].filter(Boolean).join(', ')
  const requestedSource = text(formData.get('location_source') ?? fallback.location_source, 40)
  const source = LOCATION_SOURCES.has(requestedSource) ? requestedSource : 'city_search'
  const accuracy = number(formData.get('location_accuracy_m') ?? fallback.location_accuracy_m)

  if (!city || latitude === null || longitude === null) throw new Error('Choose a city or use your current location.')
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Choose a valid location.')
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new Error('Choose a valid country.')

  return {
    city,
    region,
    country,
    country_code: countryCode,
    latitude,
    longitude,
    timezone,
    location_label: label,
    location_source: source,
    location_accuracy_m: accuracy === null ? null : Math.max(0, accuracy),
    location_updated_at: new Date().toISOString()
  }
}
