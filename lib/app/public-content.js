import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { getGlobalLocationsByIds, searchGlobalLocations } from './global-location-search'
import { getCachedPublicLocation, getCachedPublicLocationRecommendations } from './public-location-cache'
import { filterModeratedLocationRows, isLocationSuspended } from './location-moderation-overlay'

const demoHost = {
  id: 'demo-host', slug: 'puddle-city-guides', name: 'Puddle City Guides', kind: 'community_group', description: 'A playful collection of plans, places, and tiny reasons to leave the house.', city: 'Toronto', verification_status: 'verified', contact_links: { website: 'https://puddle.you' }, logo_url: null
}
const demoPlace = {
  id: 'demo-place', slug: 'moonlight-cafe', name: 'Moonlight Café', kind: 'cafe', summary: 'Late-night espresso, vinyl, and soft lights.', description: 'A cozy neighborhood café made for catching up, finishing a project, or starting the night somewhere unhurried.', city: 'Toronto', neighborhood: 'Kensington Market', address_public: 'Kensington Market, Toronto', has_private_address: false, timezone: 'America/Toronto', opening_hours: { monday: '08:00-23:00', tuesday: '08:00-23:00', wednesday: '08:00-23:00', thursday: '08:00-01:00', friday: '08:00-01:00', saturday: '09:00-01:00', sunday: '09:00-22:00' }, amenities: ['Wi-Fi','outlets','late-night','vinyl'], tags: ['coffee','cozy','late-night'], accessibility: { wheelchair_accessible: true, step_free: true, notes: 'Step-free front entrance.' }, price_level: 2, visibility: 'public', comments_enabled: true, contact_links: { website: 'https://puddle.you' }, status: 'published', host_profile_id: demoHost.id, host: demoHost, cover_url: null, gallery: []
}
const demoEvent = {
  id: 'demo-event', slug: 'neon-garden', title: 'Neon Garden', category: 'live-music', summary: 'A glowing rooftop set with local DJs and skyline views.', description: 'Come for the sunset, stay for the neon. Neon Garden brings together local DJs, immersive light installations, and a relaxed rooftop crowd.', tags: ['live music','rooftop','local'], starts_at: '2026-08-14T22:00:00-04:00', ends_at: '2026-08-15T02:00:00-04:00', timezone: 'America/Toronto', recurrence_rule: null, event_format: 'in_person', address_public: 'The Junction, Toronto', has_private_address: false, exact_address_after_rsvp: false, capacity: 240, min_age: 18, price_from_cents: 1800, currency: 'CAD', visibility: 'public', approval_required: false, comments_enabled: true, chat_enabled: true, accessibility: { wheelchair_accessible: true, accessible_washroom: true, notes: 'Elevator access is available from the east entrance.' }, contact_links: { website: 'https://puddle.you' }, status: 'published', host_profile_id: demoHost.id, host: demoHost, location: { ...demoPlace, name: 'The Junction Rooftop', slug: 'junction-rooftop', address_public: 'The Junction, Toronto' }, cover_url: null, gallery: []
}

async function queryOne(query) {
  try { const { data, error } = await query; return error ? null : data } catch { return null }
}
async function queryMany(query) {
  try { const { data, error } = await query; return error ? [] : data || [] } catch { return [] }
}
function publicUrl(supabase, path) {
  if (!path) return null
  if (String(path).startsWith('/') || /^https:\/\//i.test(String(path))) return String(path)
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}
async function galleryFor(supabase, table, targetColumn, id) {
  const rows = await queryMany(supabase.from(table).select('sort_order,caption,media_assets!inner(id,object_path,status,visibility)').eq(targetColumn, id).order('sort_order'))
  return rows.filter((row) => row.media_assets?.status === 'approved' && row.media_assets?.visibility === 'public').map((row) => ({ id: row.media_assets.id, url: publicUrl(supabase, row.media_assets.object_path), caption: row.caption }))
}
function withCardMedia(supabase, item) {
  return { ...item, cover_url: publicUrl(supabase, item.cover_path) }
}

function globalLocationShape(row) {
  if (!row) return null
  const photo = row.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.category || row.kind || 'place',
    summary: row.summary || row.description || null,
    description: row.description || row.summary || null,
    city: row.city || null,
    neighborhood: row.neighborhood || null,
    region: row.region || null,
    region_code: row.region_code || null,
    country: row.country || null,
    country_code: row.country_code || null,
    postal_code: row.postal_code || null,
    address_public: row.address || row.address_public || null,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone || 'UTC',
    timezone_verified: Boolean(row.timezone_verified),
    opening_hours: row.opening_hours && typeof row.opening_hours === 'object' ? row.opening_hours : {},
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    accessibility: row.accessibility && typeof row.accessibility === 'object' ? row.accessibility : {},
    price_level: Number.isInteger(Number(row.price_level)) ? Number(row.price_level) : null,
    website_url: row.website_url || null,
    phone_public: row.phone_public || null,
    status: row.status || 'published',
    visibility: 'public',
    tags: [],
    comments_enabled: true,
    has_private_address: false,
    cover_url: openPhotoUrlForHash(photo.content_hash),
    cover_path: null,
    gallery: [],
    host: null
  }
}

function globalLocationCard(row) {
  const location = globalLocationShape(row)
  if (!location) return null
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    summary: location.summary,
    kind: location.kind,
    city: location.city,
    price_level: location.price_level,
    cover_url: location.cover_url,
    content_kind: 'place'
  }
}

async function globalLocationById(supabase, id) {
  if (!id) return null
  try {
    const rows = await getGlobalLocationsByIds([id])
    const row = rows[0] || null
    if (!row || await isLocationSuspended(supabase, row.id)) return null
    return globalLocationShape(row)
  } catch {
    return null
  }
}

async function similarGlobalPlaces(supabase, location, limit = 2) {
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  try {
    const result = await searchGlobalLocations({
      latitude,
      longitude,
      distanceKm: 50,
      filters: location.kind ? { category: location.kind } : {},
      excludeIds: location.id ? [location.id] : [],
      candidateLimit: Math.max(limit + 2, 4)
    })
    const rows = await filterModeratedLocationRows(supabase, result.candidates)
    return rows.slice(0, limit).map(globalLocationCard).filter(Boolean)
  } catch {
    return []
  }
}

async function enrichEvent(supabase, event) {
  if (!event) return null
  const [location, host, gallery] = await Promise.all([
    event.location_id ? globalLocationById(supabase, event.location_id) : null,
    event.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', event.host_profile_id).maybeSingle()) : null,
    galleryFor(supabase, 'event_media', 'event_id', event.id)
  ])
  return { ...event, cover_url: publicUrl(supabase, event.cover_path), gallery, location, host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null }
}

export async function getPublicEvent(slug) {
  if (!isSupabaseConfigured()) return slug === demoEvent.slug ? { event: demoEvent, similar: [demoPlace] } : null
  const supabase = await createClient()
  const event = await queryOne(supabase.from('events').select('*').eq('slug', slug).eq('status', 'published').maybeSingle())
  if (!event) return null
  const enriched = await enrichEvent(supabase, event)
  const [similarEvents, similarPlaces] = await Promise.all([
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('category', event.category).neq('id', event.id).limit(3)),
    similarGlobalPlaces(supabase, enriched?.location, 2)
  ])
  return { event: enriched, similar: [...similarEvents.map((item) => ({ ...withCardMedia(supabase,item), content_kind: 'event' })), ...similarPlaces] }
}

export async function getPublicLocation(slug) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null
  return getCachedPublicLocation(slug)
}

export async function getPublicLocationRecommendations(slug) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? [demoEvent] : []
  return getCachedPublicLocationRecommendations(slug)
}

export async function getPublicHost(slug) {
  if (!isSupabaseConfigured()) return slug === demoHost.slug ? { host: demoHost, events: [demoEvent], locations: [demoPlace] } : null
  const supabase = await createClient()
  const host = await queryOne(supabase.from('host_profiles').select('*').eq('slug', slug).eq('status', 'active').maybeSingle())
  if (!host) return null
  const [events, locationLinks] = await Promise.all([
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('host_profile_id', host.id).order('starts_at').limit(12)),
    queryMany(supabase.from('location_host_links').select('location_id,claimed_at').eq('host_profile_id', host.id).order('claimed_at', { ascending: false }).limit(12))
  ])
  let locationRows = []
  try {
    locationRows = await getGlobalLocationsByIds(locationLinks.map((row) => row.location_id))
    locationRows = await filterModeratedLocationRows(supabase, locationRows)
  } catch {
    locationRows = []
  }
  const byId = new Map(locationRows.map((row) => [String(row.id), row]))
  const locations = locationLinks.map((link) => globalLocationCard(byId.get(String(link.location_id)))).filter(Boolean)
  return { host: { ...host, logo_url: publicUrl(supabase, host.logo_path) }, events: events.map((item)=>withCardMedia(supabase,item)), locations }
}

export function eventStructuredData(event, url) {
  return {
    '@context': 'https://schema.org', '@type': 'Event', name: event.title, description: event.summary || event.description,
    image: event.cover_url ? [event.cover_url, ...(event.gallery || []).map((item)=>item.url)] : undefined,
    startDate: event.starts_at, endDate: event.ends_at, eventAttendanceMode: event.event_format === 'online' ? 'https://schema.org/OnlineEventAttendanceMode' : event.event_format === 'hybrid' ? 'https://schema.org/MixedEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled', url,
    location: event.event_format === 'online' ? { '@type': 'VirtualLocation', url: event.online_url } : { '@type': 'Place', name: event.location?.name || event.address_public || 'Location shared by host', address: event.location?.address_public || event.address_public || undefined },
    organizer: event.host ? { '@type': 'Organization', name: event.host.name, url: `/hosts/${event.host.slug}` } : undefined,
    offers: { '@type': 'Offer', price: (event.price_from_cents || 0) / 100, priceCurrency: event.currency || 'CAD', availability: 'https://schema.org/InStock', url }
  }
}
export function placeStructuredData(location, url) {
  return { '@context': 'https://schema.org', '@type': 'Place', name: location.name, description: location.summary || location.description, image: location.cover_url ? [location.cover_url, ...(location.gallery || []).map((item)=>item.url)] : undefined, url, address: location.address_public || undefined, geo: location.latitude && location.longitude ? { '@type':'GeoCoordinates', latitude:location.latitude, longitude:location.longitude } : undefined, amenityFeature: (location.amenities || []).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })) }
}

export { demoEvent, demoPlace, demoHost }
