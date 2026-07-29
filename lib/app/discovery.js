import { randomUUID } from 'node:crypto'

const DEFAULT_CENTER = { latitude: 43.6532, longitude: -79.3832 }
const DISTANCE_OPTIONS = new Set([2, 5, 10, 25, 50, 100])
const KIND_OPTIONS = new Set(['all', 'event', 'place'])
const DATE_OPTIONS = new Set(['any', 'tonight', 'weekend', 'next7'])
const PRICE_OPTIONS = new Set(['any', 'free', '1', '2', '3', '4'])

const fallbackCandidates = [
  { content_kind: 'event', content_id: '00000000-0000-0000-0000-000000000101', slug: 'neon-garden', title: 'Neon Garden', summary: 'A glowing rooftop set with local DJs and skyline views.', category: 'live-music', starts_at: '2026-08-14T22:00:00-04:00', ends_at: '2026-08-15T02:00:00-04:00', timezone: 'America/Toronto', price_cents: 1800, price_level: 2, min_age: 18, capacity: 240, remaining_capacity: 80, accessibility: { wheelchair_accessible: true }, amenities: [], opening_hours: {}, latitude: 43.665, longitude: -79.465, distance_m: 2800, cover_path: null, host_name: 'Puddle City Guides', host_verified: true, published_at: '2026-07-20T12:00:00Z' },
  { content_kind: 'place', content_id: '00000000-0000-0000-0000-000000000102', slug: 'moonlight-cafe', title: 'Moonlight Café', summary: 'Late-night espresso, vinyl, and soft lights.', category: 'cafe', starts_at: null, ends_at: null, timezone: 'America/Toronto', price_cents: null, price_level: 2, min_age: null, capacity: null, remaining_capacity: null, accessibility: { wheelchair_accessible: true, step_free: true }, amenities: ['wifi', 'outlets', 'late-night'], opening_hours: { monday: '08:00-23:00', tuesday: '08:00-23:00', wednesday: '08:00-23:00', thursday: '08:00-01:00', friday: '08:00-01:00', saturday: '09:00-01:00', sunday: '09:00-22:00' }, latitude: 43.6547, longitude: -79.4023, distance_m: 1600, cover_path: null, host_name: 'Puddle City Guides', host_verified: true, published_at: '2026-07-18T12:00:00Z' },
  { content_kind: 'place', content_id: '00000000-0000-0000-0000-000000000103', slug: 'sunset-steps', title: 'Sunset Steps', summary: 'A west-facing lookout made for golden hour.', category: 'scenic_spot', starts_at: null, ends_at: null, timezone: 'America/Toronto', price_cents: null, price_level: 1, min_age: null, capacity: null, remaining_capacity: null, accessibility: { step_free: false }, amenities: ['outdoors', 'free', 'views'], opening_hours: { monday: '06:00-23:00', tuesday: '06:00-23:00', wednesday: '06:00-23:00', thursday: '06:00-23:00', friday: '06:00-23:00', saturday: '06:00-23:00', sunday: '06:00-23:00' }, latitude: 43.67, longitude: -79.354, distance_m: 4100, cover_path: null, host_name: null, host_verified: false, published_at: '2026-07-10T12:00:00Z' }
]

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function number(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on'
}

export function parseDiscoveryFilters(source = {}) {
  const kind = KIND_OPTIONS.has(source.kind) ? source.kind : 'all'
  const date = DATE_OPTIONS.has(source.date) ? source.date : 'any'
  const distance = DISTANCE_OPTIONS.has(Number(source.distance)) ? Number(source.distance) : 25
  const price = PRICE_OPTIONS.has(String(source.price)) ? String(source.price) : 'any'
  return {
    q: text(source.q, 100).toLowerCase(),
    kind,
    category: text(source.category, 60),
    date,
    distance,
    price,
    openNow: boolean(source.open_now ?? source.openNow),
    accessible: boolean(source.accessible),
    available: boolean(source.available),
    amenity: text(source.amenity, 60).toLowerCase(),
    latitude: number(source.latitude, null),
    longitude: number(source.longitude, null),
    limit: Math.min(100, Math.max(1, number(source.limit, 40)))
  }
}

function dateWindow(filter, now = new Date()) {
  if (filter === 'any') return null
  if (filter === 'tonight') {
    const start = new Date(now)
    start.setHours(17, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    end.setHours(5, 0, 0, 0)
    return [start, end]
  }
  if (filter === 'next7') return [now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)]
  const start = new Date(now)
  const day = start.getDay()
  const daysUntilFriday = (5 - day + 7) % 7
  start.setDate(start.getDate() + daysUntilFriday)
  start.setHours(16, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 3)
  end.setHours(5, 0, 0, 0)
  return [start, end]
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
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: false })
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
  const day = String(parts.weekday || '').toLowerCase()
  const value = String(openingHours[day] || '').trim()
  if (!value || /^closed$/i.test(value)) return false
  if (/24\s*hours|open\s*24/i.test(value)) return true
  const [rawStart, rawEnd] = value.replace(/[–—]/g, '-').split('-').map((part) => part.trim())
  const start = parseClock(rawStart)
  const end = parseClock(rawEnd)
  if (start === null || end === null) return true
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
  return end >= start ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
}

function ageFromBirthDate(value) {
  if (!value) return null
  const birth = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday = now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

function publicMediaUrl(supabase, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function candidateMatches(candidate, filters, profile) {
  const haystack = `${candidate.title} ${candidate.summary || ''} ${candidate.category || ''} ${(candidate.amenities || []).join(' ')}`.toLowerCase()
  if (filters.q && !haystack.includes(filters.q)) return false
  if (filters.kind !== 'all' && candidate.content_kind !== filters.kind) return false
  if (filters.category && candidate.category !== filters.category) return false
  if (candidate.distance_m !== null && candidate.distance_m !== undefined && candidate.distance_m > filters.distance * 1000) return false

  const window = dateWindow(filters.date)
  if (window && candidate.content_kind === 'event') {
    const starts = new Date(candidate.starts_at)
    if (starts < window[0] || starts > window[1]) return false
  }
  if (window && candidate.content_kind === 'place') return false
  if (filters.openNow && (candidate.content_kind !== 'place' || !isOpenAt(candidate.opening_hours, candidate.timezone))) return false
  if (filters.accessible && !candidate.accessibility?.wheelchair_accessible && !candidate.accessibility?.step_free) return false
  if (filters.available && candidate.content_kind === 'event' && candidate.remaining_capacity !== null && candidate.remaining_capacity <= 0) return false
  if (filters.amenity && !(candidate.amenities || []).some((item) => String(item).toLowerCase().includes(filters.amenity))) return false

  if (filters.price === 'free' && candidate.content_kind === 'event' && Number(candidate.price_cents || 0) > 0) return false
  if (/^[1-4]$/.test(filters.price) && candidate.content_kind === 'place' && Number(candidate.price_level || 0) !== Number(filters.price)) return false

  const age = ageFromBirthDate(profile?.birth_date)
  if (age !== null && candidate.min_age && age < candidate.min_age) return false
  return true
}

function scoreCandidate(candidate, filters, profile, now = new Date()) {
  let score = 0
  const reasons = []
  const interests = new Set((profile?.interests || []).map((item) => String(item).toLowerCase()))

  if (candidate.distance_m !== null && candidate.distance_m !== undefined) {
    const proximity = Math.max(0, 30 - candidate.distance_m / 1500)
    score += proximity
    if (candidate.distance_m <= 3000) reasons.push('Nearby')
  }
  if (interests.has(String(candidate.category || '').toLowerCase())) {
    score += 26
    reasons.push(`Matches ${candidate.category.replaceAll('_', ' ')}`)
  }
  if (candidate.content_kind === 'event' && candidate.starts_at) {
    const hours = (new Date(candidate.starts_at).getTime() - now.getTime()) / 3_600_000
    if (hours >= 0 && hours <= 24) {
      score += 22
      reasons.push('Happening soon')
    } else if (hours > 24 && hours <= 168) {
      score += 12
      reasons.push('This week')
    }
  }
  if (candidate.content_kind === 'place' && isOpenAt(candidate.opening_hours, candidate.timezone, now)) {
    score += 12
    reasons.push('Open now')
  }
  if (candidate.host_verified) {
    score += 7
    reasons.push('Verified host')
  }
  if (candidate.remaining_capacity === null || candidate.remaining_capacity > 0) score += 5
  if (candidate.published_at && now.getTime() - new Date(candidate.published_at).getTime() < 7 * 24 * 60 * 60 * 1000) {
    score += 6
    reasons.push('Fresh listing')
  }
  if (filters.q) score += 8
  return { score: Math.round(score * 100) / 100, reasons: reasons.slice(0, 3) }
}

function diversify(items, limit) {
  const remaining = [...items]
  const result = []
  while (remaining.length && result.length < limit) {
    let index = remaining.findIndex((candidate) => {
      const recent = result.slice(-5)
      const sameKind = recent.filter((item) => item.content_kind === candidate.content_kind).length
      const sameCategory = recent.filter((item) => item.category === candidate.category).length
      return sameKind < 3 && sameCategory < 2
    })
    if (index < 0) index = 0
    result.push(remaining.splice(index, 1)[0])
  }
  return result
}

async function queryCandidates(supabase, filters, profile) {
  const latitude = filters.latitude ?? profile?.latitude ?? DEFAULT_CENTER.latitude
  const longitude = filters.longitude ?? profile?.longitude ?? DEFAULT_CENTER.longitude
  const { data, error } = await supabase.rpc('discover_candidates_v1', {
    user_lat: latitude,
    user_lng: longitude,
    radius_m: filters.distance * 1000,
    max_rows: 250
  })
  if (!error && data?.length) return { candidates: data, center: { latitude, longitude }, fallback: false }

  const [eventsResult, locationsResult] = await Promise.all([
    supabase.from('events').select('id,slug,title,summary,category,starts_at,ends_at,timezone,price_from_cents,min_age,capacity,accessibility,cover_path,published_at,location_id,locations(latitude,longitude,city),host_profiles(name,verification_status)').eq('status', 'published').limit(100),
    supabase.from('locations').select('id,slug,name,summary,kind,timezone,price_level,accessibility,amenities,opening_hours,latitude,longitude,cover_path,updated_at,host_profiles(name,verification_status)').eq('status', 'published').limit(100)
  ])
  const events = (eventsResult.data || []).map((event) => ({
    content_kind: 'event', content_id: event.id, slug: event.slug, title: event.title, summary: event.summary, category: event.category,
    starts_at: event.starts_at, ends_at: event.ends_at, timezone: event.timezone, price_cents: event.price_from_cents, price_level: null,
    min_age: event.min_age, capacity: event.capacity, remaining_capacity: null, accessibility: event.accessibility || {}, amenities: [], opening_hours: {},
    latitude: event.locations?.latitude, longitude: event.locations?.longitude, distance_m: null, cover_path: event.cover_path,
    host_name: event.host_profiles?.name, host_verified: event.host_profiles?.verification_status === 'verified', published_at: event.published_at
  }))
  const places = (locationsResult.data || []).map((location) => ({
    content_kind: 'place', content_id: location.id, slug: location.slug, title: location.name, summary: location.summary, category: location.kind,
    starts_at: null, ends_at: null, timezone: location.timezone, price_cents: null, price_level: location.price_level,
    min_age: null, capacity: null, remaining_capacity: null, accessibility: location.accessibility || {}, amenities: location.amenities || [], opening_hours: location.opening_hours || {},
    latitude: location.latitude, longitude: location.longitude, distance_m: null, cover_path: location.cover_path,
    host_name: location.host_profiles?.name, host_verified: location.host_profiles?.verification_status === 'verified', published_at: location.updated_at
  }))
  return { candidates: [...events, ...places].length ? [...events, ...places] : fallbackCandidates, center: { latitude, longitude }, fallback: !events.length && !places.length }
}

export async function getDiscoveryFeed(session, rawFilters = {}) {
  const filters = parseDiscoveryFilters(rawFilters)
  const requestId = randomUUID()
  const [{ candidates, center, fallback }, dismissedResult] = await Promise.all([
    queryCandidates(session.supabase, filters, session.profile),
    session.supabase.from('discovery_actions').select('event_id,location_id').eq('profile_id', session.user.id).eq('action', 'dismissed').is('undone_at', null)
  ])
  const dismissed = new Set((dismissedResult.data || []).map((item) => item.event_id ? `event:${item.event_id}` : `place:${item.location_id}`))
  const ranked = candidates
    .filter((candidate) => !dismissed.has(`${candidate.content_kind}:${candidate.content_id}`))
    .filter((candidate) => candidateMatches(candidate, filters, session.profile))
    .map((candidate) => {
      const ranking = scoreCandidate(candidate, filters, session.profile)
      return {
        ...candidate,
        score: ranking.score,
        reasons: ranking.reasons,
        cover_url: publicMediaUrl(session.supabase, candidate.cover_path),
        href: candidate.content_kind === 'event' ? `/events/${candidate.slug}` : `/places/${candidate.slug}`,
        kindLabel: candidate.content_kind === 'event' ? 'EVENT' : 'PLACE',
        distanceLabel: candidate.distance_m === null || candidate.distance_m === undefined ? 'Distance unavailable' : candidate.distance_m < 1000 ? `${Math.round(candidate.distance_m)} m` : `${(candidate.distance_m / 1000).toFixed(1)} km`,
        priceLabel: candidate.content_kind === 'event' ? (candidate.price_cents ? `$${Math.round(candidate.price_cents / 100)}` : 'Free') : (candidate.price_level ? '$'.repeat(candidate.price_level) : 'Price varies')
      }
    })
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))

  const items = diversify(ranked, filters.limit)
  const categories = [...new Set(candidates.map((item) => item.category).filter(Boolean))].sort()
  return { requestId, items, filters, center, categories, fallback, rankingVersion: 'rules-v1' }
}

export async function logDiscoveryImpressions(session, feed) {
  if (!feed.items.length) return
  const rows = feed.items.slice(0, 60).map((item, index) => ({
    profile_id: session.user.id,
    request_id: feed.requestId,
    content_kind: item.content_kind,
    event_id: item.content_kind === 'event' ? item.content_id : null,
    location_id: item.content_kind === 'place' ? item.content_id : null,
    rank_position: index + 1,
    score: item.score,
    reasons: item.reasons,
    ranking_version: feed.rankingVersion,
    filters: feed.filters
  }))
  await session.supabase.from('discovery_impressions').insert(rows)
}

export async function getMapContent(session, bounds) {
  const minLatitude = number(bounds.min_lat)
  const minLongitude = number(bounds.min_lng)
  const maxLatitude = number(bounds.max_lat)
  const maxLongitude = number(bounds.max_lng)
  if ([minLatitude, minLongitude, maxLatitude, maxLongitude].some((value) => value === null)) return []
  const { data, error } = await session.supabase.rpc('content_in_view_v1', {
    min_lat: minLatitude,
    min_lng: minLongitude,
    max_lat: maxLatitude,
    max_lng: maxLongitude,
    max_rows: 300
  })
  return error ? [] : data || []
}

export { DEFAULT_CENTER }
