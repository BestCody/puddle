import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { demoEvent, demoPlace } from './public-content'
import { getGlobalLocationBySlug, isGlobalLocationSearchConfigured, searchGlobalLocations } from './global-location-search'

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

async function galleryFor(supabase, locationId) {
  const rows = await queryMany(
    supabase
      .from('location_media')
      .select('sort_order,caption,media_assets!inner(id,object_path,status,visibility)')
      .eq('location_id', locationId)
      .order('sort_order')
  )
  return rows
    .filter((row) => row.media_assets?.status === 'approved' && row.media_assets?.visibility === 'public')
    .map((row) => ({ id: row.media_assets.id, url: publicUrl(supabase, row.media_assets.object_path), caption: row.caption }))
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
    gallery: photo.url ? [{ id: `canonical-${row.id}`, url: photo.url, caption: photo.attribution || null }] : [],
    host: null
  }
}

async function globalSimilar(location) {
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
    })
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

async function firstPartyOverlay(supabase, location) {
  const [local, gallery, host, events] = await Promise.all([
    queryOne(supabase.from('locations').select('*').eq('id', location.id).maybeSingle()).catch(() => null),
    galleryFor(supabase, location.id).catch(() => []),
    queryOne(supabase.from('locations').select('host_profile_id').eq('id', location.id).maybeSingle())
      .then((row) => row?.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', row.host_profile_id).maybeSingle()) : null)
      .catch(() => null),
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('location_id', location.id).limit(3)).catch(() => [])
  ])

  const enriched = {
    ...location,
    ...(local ? {
      description: local.description || location.description,
      summary: local.summary || location.summary,
      tags: local.tags || location.tags,
      comments_enabled: local.comments_enabled ?? location.comments_enabled,
      host_profile_id: local.host_profile_id || null
    } : {}),
    gallery: gallery.length ? gallery : location.gallery,
    host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null
  }
  return {
    location: enriched,
    events: events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' }))
  }
}

async function loadGlobalPublicLocation(slug) {
  const row = await getGlobalLocationBySlug(slug)
  if (!row) return null
  let location = globalLocationShape(row)
  let events = []
  if (isSupabaseConfigured()) {
    const supabase = createPublicClient()
    const overlay = await firstPartyOverlay(supabase, location)
    location = overlay.location
    events = overlay.events
  }
  const similarPlaces = await globalSimilar(location)
  return { location, similar: [...events, ...similarPlaces].slice(0, 6) }
}

async function loadLegacyPublicLocation(slug) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null

  const supabase = createPublicClient()
  const location = await queryOne(supabase.from('locations').select('*').eq('slug', slug).eq('status', 'published').maybeSingle())
  if (!location) return null

  const [host, gallery, similarPlaces, events] = await Promise.all([
    location.host_profile_id ? queryOne(supabase.from('host_profiles').select('*').eq('id', location.host_profile_id).maybeSingle()) : null,
    galleryFor(supabase, location.id),
    queryMany(supabase.from('locations').select('id,slug,name,summary,kind,city,price_level,cover_path').eq('status', 'published').eq('kind', location.kind).neq('id', location.id).limit(3)),
    queryMany(supabase.from('events').select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path').eq('status', 'published').eq('location_id', location.id).limit(3))
  ])

  const enriched = { ...location, cover_url: publicUrl(supabase, location.cover_path), gallery, host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null }
  return {
    location: enriched,
    similar: [
      ...events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' })),
      ...similarPlaces.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'place' }))
    ]
  }
}

async function loadPublicLocation(slug) {
  const useGlobal = String(process.env.GLOBAL_LOCATION_SEARCH_ENABLED || '').toLowerCase() === 'true' && isGlobalLocationSearchConfigured()
  if (useGlobal) {
    try {
      const result = await loadGlobalPublicLocation(slug)
      if (result) return result
    } catch (error) {
      if (String(process.env.GLOBAL_LOCATION_FALLBACK_TO_SUPABASE || 'true').toLowerCase() !== 'true') throw error
      console.error(`Global place lookup failed; using transitional Supabase fallback: ${error?.message || 'unknown error'}`)
    }
  }
  return loadLegacyPublicLocation(slug)
}

export const getCachedPublicLocation = unstable_cache(loadPublicLocation, ['public-location-v2'], { revalidate: 300, tags: ['public-locations'] })
