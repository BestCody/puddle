import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { getGlobalLocationBySlug, searchGlobalLocations } from './global-location-search'
import {
  SERVER_LATENCY_BUDGET_MS,
  createTraceId,
  elapsedMs,
  latencyStart,
  recordServerLatency,
  recordSloObservation
} from '@/lib/performance/server-latency'

async function queryOne(query) {
  const { data, error } = await query
  if (error) throw error
  return data || null
}

async function queryMany(query) {
  const { data, error } = await query
  if (error) throw error
  return data || []
}

function publicUrl(supabase, path) {
  if (!path) return null
  if (/^https:\/\//i.test(String(path)) || String(path).startsWith('/')) return String(path)
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

async function attachedLocationPhoto(supabase, locationId) {
  const rows = await queryMany(
    supabase
      .from('location_media')
      .select('sort_order,caption,media_assets!inner(id,object_path,status,visibility)')
      .eq('location_id', locationId)
      .order('sort_order')
      .limit(1)
  )
  const row = rows.find((item) => item.media_assets?.status === 'approved' && item.media_assets?.visibility === 'public')
  if (!row) return null
  return { id: row.media_assets.id, url: publicUrl(supabase, row.media_assets.object_path), caption: row.caption }
}

async function claimedHost(supabase, locationId) {
  const link = await queryOne(
    supabase
      .from('location_host_links')
      .select('host_profile_id')
      .eq('location_id', locationId)
      .maybeSingle()
  )
  if (!link?.host_profile_id) return null
  const host = await queryOne(
    supabase
      .from('host_profiles')
      .select('id,name,slug,kind,description,logo_path,city,website_url,verification_status,status')
      .eq('id', link.host_profile_id)
      .eq('status', 'active')
      .maybeSingle()
  )
  return host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null
}

function withCardMedia(supabase, item) {
  return { ...item, cover_url: publicUrl(supabase, item.cover_path) }
}

function globalLocationShape(row) {
  const photo = row?.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
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
    brand_id: row.brand_id || null,
    brand_name: row.brand_name || null,
    status: row.status || 'published',
    visibility: 'public',
    source: 'global_catalogue',
    tags: [],
    comments_enabled: true,
    has_private_address: false,
    cover_url: openPhotoUrlForHash(photo.content_hash),
    cover_path: null,
    gallery: [],
    host: null
  }
}

async function globalSimilar(location, traceId) {
  const lat = Number(location.latitude)
  const lon = Number(location.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
  try {
    const result = await searchGlobalLocations({
      latitude: lat,
      longitude: lon,
      distanceKm: 50,
      filters: { category: location.kind },
      excludeIds: [location.id],
      candidateLimit: 4
    }, { traceId })
    return result.candidates.slice(0, 3).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary || row.description || null,
      kind: row.category,
      city: row.city,
      cover_url: openPhotoUrlForHash(row.primary_photo?.content_hash),
      content_kind: 'place'
    }))
  } catch {
    return []
  }
}

async function relationalProductOverlay(supabase, location, traceId) {
  const started = latencyStart()
  const [attached, host, events] = await Promise.all([
    attachedLocationPhoto(supabase, location.id).catch(() => null),
    claimedHost(supabase, location.id).catch(() => null),
    queryMany(
      supabase
        .from('events')
        .select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path')
        .eq('status', 'published')
        .eq('location_id', location.id)
        .limit(3)
    ).catch(() => [])
  ])
  recordServerLatency('supabase.locationProductOverlay', elapsedMs(started), SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
    trace_id: traceId,
    service: 'supabase',
    operation: 'locationProductOverlay'
  })
  return {
    location: { ...location, cover_url: attached?.url || location.cover_url || null, host },
    events: events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' }))
  }
}

async function loadPublicLocation(slug) {
  const traceId = createTraceId()
  const started = latencyStart()
  try {
    const row = await getGlobalLocationBySlug(slug, { traceId })
    if (!row) {
      recordSloObservation('locationDetail', elapsedMs(started), true, { trace_id: traceId, service: 'vercel', serving_mode: 'opensearch' })
      return null
    }
    let location = globalLocationShape(row)
    let events = []
    if (isSupabaseConfigured()) {
      const overlay = await relationalProductOverlay(createPublicClient(), location, traceId)
      location = overlay.location
      events = overlay.events
    }
    const similarPlaces = await globalSimilar(location, traceId)
    recordSloObservation('locationDetail', elapsedMs(started), true, { trace_id: traceId, service: 'vercel', serving_mode: 'opensearch' })
    return { location, similar: [...events, ...similarPlaces].slice(0, 6) }
  } catch (error) {
    recordSloObservation('locationDetail', elapsedMs(started), false, { trace_id: traceId, service: 'vercel', serving_mode: 'opensearch' })
    throw error
  }
}

export const getCachedPublicLocation = unstable_cache(loadPublicLocation, ['public-location-v5'], { revalidate: 300, tags: ['public-locations'] })
