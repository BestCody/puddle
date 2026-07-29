import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'

const demoHost = {
  id: 'demo-host', slug: 'puddle-city-guides', name: 'Puddle City Guides', kind: 'community_group', description: 'A playful collection of plans, places, and tiny reasons to leave the house.', city: 'Toronto', verification_status: 'verified', contact_links: { website: 'https://puddle.you' }
}

const demoPlace = {
  id: 'demo-place', slug: 'moonlight-cafe', name: 'Moonlight Café', kind: 'cafe', summary: 'Late-night espresso, vinyl, and soft lights.', description: 'A cozy neighborhood café made for catching up, finishing a project, or starting the night somewhere unhurried.', city: 'Toronto', neighborhood: 'Kensington Market', address_public: 'Kensington Market, Toronto', private_address: null, timezone: 'America/Toronto', opening_hours: { monday: '8:00 AM–11:00 PM', tuesday: '8:00 AM–11:00 PM', wednesday: '8:00 AM–11:00 PM', thursday: '8:00 AM–1:00 AM', friday: '8:00 AM–1:00 AM', saturday: '9:00 AM–1:00 AM', sunday: '9:00 AM–10:00 PM' }, amenities: ['Wi-Fi','outlets','late-night','vinyl'], tags: ['coffee','cozy','late-night'], accessibility: { wheelchair_accessible: true, step_free: true, notes: 'Step-free front entrance.' }, price_level: 2, visibility: 'public', comments_enabled: true, contact_links: { website: 'https://puddle.you' }, status: 'published', host_profile_id: demoHost.id, host: demoHost
}

const demoEvent = {
  id: 'demo-event', slug: 'neon-garden', title: 'Neon Garden', category: 'live-music', summary: 'A glowing rooftop set with local DJs, plants, and a skyline view.', description: 'Come for the sunset, stay for the neon. Neon Garden brings together local DJs, immersive light installations, and a relaxed rooftop crowd.', tags: ['live music','rooftop','local'], starts_at: '2026-08-14T22:00:00-04:00', ends_at: '2026-08-15T02:00:00-04:00', timezone: 'America/Toronto', recurrence_rule: null, event_format: 'in_person', address_public: 'The Junction, Toronto', private_address: null, exact_address_after_rsvp: false, capacity: 240, min_age: 18, price_from_cents: 1800, currency: 'CAD', visibility: 'public', approval_required: false, comments_enabled: true, chat_enabled: true, accessibility: { wheelchair_accessible: true, accessible_washroom: true, notes: 'Elevator access is available from the east entrance.' }, contact_links: { website: 'https://puddle.you' }, status: 'published', host_profile_id: demoHost.id, host: demoHost, location: { ...demoPlace, name: 'The Junction Rooftop', slug: 'junction-rooftop', address_public: 'The Junction, Toronto' }
}

async function queryOne(query) {
  try {
    const { data, error } = await query
    return error ? null : data
  } catch {
    return null
  }
}

async function queryMany(query) {
  try {
    const { data, error } = await query
    return error ? [] : data || []
  } catch {
    return []
  }
}

async function enrichEvent(supabase, event) {
  if (!event) return null
  const [location, host] = await Promise.all([
    event.location_id ? queryOne(supabase.from('locations').select('*').eq('id', event.location_id).maybeSingle()) : null,
    event.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', event.host_profile_id).maybeSingle()) : null
  ])
  return { ...event, location, host }
}

async function enrichLocation(supabase, location) {
  if (!location) return null
  const host = location.host_profile_id ? await queryOne(supabase.from('host_profiles').select('*').eq('id', location.host_profile_id).maybeSingle()) : null
  return { ...location, host }
}

export async function getPublicEvent(slug) {
  if (!isSupabaseConfigured()) return slug === demoEvent.slug ? { event: demoEvent, similar: [demoPlace] } : null
  const supabase = await createClient()
  const event = await queryOne(supabase.from('events').select('*').eq('slug', slug).eq('status', 'published').maybeSingle())
  if (!event) return slug === demoEvent.slug ? { event: demoEvent, similar: [demoPlace] } : null
  const enriched = await enrichEvent(supabase, event)
  const [similarEvents, similarPlaces] = await Promise.all([
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency').eq('status', 'published').eq('category', event.category).neq('id', event.id).limit(3)),
    queryMany(supabase.from('locations').select('id,slug,name,summary,kind,city,price_level').eq('status', 'published').limit(2))
  ])
  return { event: enriched, similar: [...similarEvents.map((item) => ({ ...item, content_kind: 'event' })), ...similarPlaces.map((item) => ({ ...item, content_kind: 'place' }))] }
}

export async function getPublicLocation(slug) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null
  const supabase = await createClient()
  const location = await queryOne(supabase.from('locations').select('*').eq('slug', slug).eq('status', 'published').maybeSingle())
  if (!location) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null
  const enriched = await enrichLocation(supabase, location)
  const [similarPlaces, events] = await Promise.all([
    queryMany(supabase.from('locations').select('id,slug,name,summary,kind,city,price_level').eq('status', 'published').eq('kind', location.kind).neq('id', location.id).limit(3)),
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency').eq('status', 'published').eq('location_id', location.id).limit(3))
  ])
  return { location: enriched, similar: [...events.map((item) => ({ ...item, content_kind: 'event' })), ...similarPlaces.map((item) => ({ ...item, content_kind: 'place' }))] }
}

export async function getPublicHost(slug) {
  if (!isSupabaseConfigured()) return slug === demoHost.slug ? { host: demoHost, events: [demoEvent], locations: [demoPlace] } : null
  const supabase = await createClient()
  const host = await queryOne(supabase.from('host_profiles').select('*').eq('slug', slug).eq('status', 'active').maybeSingle())
  if (!host) return slug === demoHost.slug ? { host: demoHost, events: [demoEvent], locations: [demoPlace] } : null
  const [events, locations] = await Promise.all([
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency').eq('status', 'published').eq('host_profile_id', host.id).order('starts_at').limit(12)),
    queryMany(supabase.from('locations').select('id,slug,name,summary,kind,city,price_level').eq('status', 'published').eq('host_profile_id', host.id).limit(12))
  ])
  return { host, events, locations }
}

export function eventStructuredData(event, url) {
  return {
    '@context': 'https://schema.org', '@type': 'Event', name: event.title, description: event.summary || event.description,
    startDate: event.starts_at, endDate: event.ends_at, eventAttendanceMode: event.event_format === 'online' ? 'https://schema.org/OnlineEventAttendanceMode' : event.event_format === 'hybrid' ? 'https://schema.org/MixedEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled', url,
    location: event.event_format === 'online' ? { '@type': 'VirtualLocation', url: event.online_url } : { '@type': 'Place', name: event.location?.name || event.address_public || 'Location shared by host', address: event.location?.address_public || event.address_public || undefined },
    organizer: event.host ? { '@type': 'Organization', name: event.host.name, url: `/hosts/${event.host.slug}` } : undefined,
    offers: { '@type': 'Offer', price: (event.price_from_cents || 0) / 100, priceCurrency: event.currency || 'CAD', availability: 'https://schema.org/InStock', url }
  }
}

export function placeStructuredData(location, url) {
  return { '@context': 'https://schema.org', '@type': 'Place', name: location.name, description: location.summary || location.description, url, address: location.address_public || undefined, amenityFeature: (location.amenities || []).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })) }
}

export { demoEvent, demoPlace, demoHost }
