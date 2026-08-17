import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { demoEvent, demoPlace } from './public-content'
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
  return data
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
    cover_url: photo.url || null,
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
      cover_url: row.primary_photo?.url || null,
      content_kind: 'place'
    }))
  } catch {
    return []
  }
}

async function firstPartyOverlay(supabase, location, traceId) {
  const started = latencyStart()
  const [local, attached, host, events] = await Promise.all([
    queryOne(supabase.from('locations').select('*').eq('id', location.id).maybeSingle()).catch(() => null),
    attachedLocationPhoto(supabase, location.id).catch(() => null),
    queryOne(supabase.from('locations').select('host_profile_id').eq('id', location.id).maybeSingle())
      .then((row) => row?.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', row.host_profile_id).maybeSingle()) : null)
      .catch(() => null),
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('location_id', location.id).limit(3)).catch(() => [])
  ])
  const durationMs = elapsedMs(started)
  recordServerLatency('supabase.locationDetailOverlay', durationMs, SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
    trace_id: traceId,
    service: 'supabase',
    operation: 'locationDetailOverlay'
  })

  const localCover = publicUrl(supabase, local?.cover_path)
  const canonicalCover = localCover || attached?.url || location.cover_url || null
  const enriched = {
    ...location,
    ...(local ? {
      description: local.description || location.description,
      summary: local.summary || location.summary,
      tags: local.tags || location.tags,
      comments_enabled: local.comments_enabled ?? location.comments_enabled,
      host_profile_id: local.host_profile_id || null
    } : {}),
    cover_url: canonicalCover,
    gallery: [],
    host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null
  }
  return {
    location: enriched,
    events: events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' }))
  }
}

async function loadGlobalPublicLocation(slug, traceId) {
  const row = await getGlobalLocationBySlug(slug, { traceId })
  if (!row) return null
  let location = globalLocationShape(row)
  let events = []
  if (isSupabaseConfigured()) {
    const supabase = createPublicClient()
    const overlay = await firstPartyOverlay(supabase, location, traceId)
    location = overlay.location
    events = overlay.events
  }
  const similarPlaces = await globalSimilar(location, traceId)
  return { location, similar: [...events, ...similarPlaces].slice(0, 6) }
}

async function loadLegacyPublicLocation(slug, traceId) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null

  const supabase = createPublicClient()
  const started = latencyStart()
  const location = await queryOne(supabase.from('locations').select('*').eq('slug', slug).eq('status', 'published').maybeSingle())
  if (!location) return null

  const [host, attached, similarPlaces, events] = await Promise.all([
    location.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', location.host_profile_id).maybeSingle()) : null,
    attachedLocationPhoto(supabase, location.id),
    queryMany(supabase.from('locations').select('id,slug,name,summary,kind,city,price_level,cover_path').eq('status', 'published').eq('kind', location.kind).neq('id', location.id).limit(3)),
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('location_id', location.id).limit(3))
  ])
  const durationMs = elapsedMs(started)
  recordServerLatency('supabase.locationDetail', durationMs, SERVER_LATENCY_BUDGET_MS.locationDetail, {
    trace_id: traceId,
    service: 'supabase',
    operation: 'locationDetail'
  })

  const coverUrl = publicUrl(supabase, location.cover_path) || attached?.url || null
  const enriched = { ...location, cover_url: coverUrl, gallery: [], host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null }
  return {
    location: enriched,
    similar: [
      ...events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' })),
      ...similarPlaces.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'place' }))
    ]
  }
}

async function loadPublicLocation(slug) {
  const traceId = createTraceId()
  const started = latencyStart()
  // The flag selects the serving architecture. If enabled, missing OpenSearch
  // configuration is an outage and must never silently route global reads to Postgres.
  const useGlobal = String(process.env.GLOBAL_LOCATION_SEARCH_ENABLED || '').toLowerCase() === 'true'
  try {
    const result = useGlobal
      ? await loadGlobalPublicLocation(slug, traceId)
      : await loadLegacyPublicLocation(slug, traceId)
    recordSloObservation('locationDetail', elapsedMs(started), true, {
      trace_id: traceId,
      service: 'vercel',
      serving_mode: useGlobal ? 'opensearch' : 'relational'
    })
    return result
  } catch (error) {
    recordSloObservation('locationDetail', elapsedMs(started), false, {
      trace_id: traceId,
      service: 'vercel',
      serving_mode: useGlobal ? 'opensearch' : 'relational'
    })
    throw error
  }
}

export const getCachedPublicLocation = unstable_cache(loadPublicLocation, ['public-location-v3'], { revalidate: 300, tags: ['public-locations'] })
