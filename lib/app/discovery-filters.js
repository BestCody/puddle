const PRICE_OPTIONS = new Set(['any', '1', '2', '3', '4'])
const MAX_SEARCH_DISTANCE_KM = 100

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

export function parseDiscoveryFilters(source = {}, defaultDistance = 25) {
  const requestedDistance = number(source.distance, number(defaultDistance, 25))
  return {
    q: text(source.q, 100).toLowerCase(),
    kind: 'place',
    category: text(source.category, 60),
    date: 'any',
    distance: Math.max(1, Math.min(MAX_SEARCH_DISTANCE_KM, requestedDistance || 25)),
    price: PRICE_OPTIONS.has(String(source.price)) ? String(source.price) : 'any',
    openNow: boolean(source.open_now ?? source.openNow),
    accessible: boolean(source.accessible),
    amenity: text(source.amenity, 60).toLowerCase(),
    latitude: number(source.latitude, null),
    longitude: number(source.longitude, null),
    locationLabel: text(source.locationLabel ?? source.location_label, 160),
    limit: Math.min(100, Math.max(1, number(source.limit, 40)))
  }
}

function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3]?.toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function isOpenAt(openingHours, timezone, at = new Date()) {
  if (!openingHours || typeof openingHours !== 'object') return false
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    })
    const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
    const value = String(openingHours[String(parts.weekday || '').toLowerCase()] || '').trim()
    if (!value || /^closed$/i.test(value)) return false
    if (/24\s*hours|open\s*24/i.test(value)) return true
    const [rawStart, rawEnd] = value.replace(/[–—]/g, '-').split('-').map((part) => part.trim())
    const start = parseClock(rawStart)
    const end = parseClock(rawEnd)
    if (start === null || end === null) return true
    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
    return end >= start
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end
  } catch {
    return false
  }
}
