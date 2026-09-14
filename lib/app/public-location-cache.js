import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { filterModeratedLocationRows, isLocationSuspended } from './location-moderation-overlay'
import {
  createTraceId,
  elapsedMs,
  latencyStart,
  recordSloObservation
} from '@/lib/performance/server-latency'

async function getGlobalLocationBySlug(slug, options = {}) {
  const search = await import('./global-location-search')
  return search.getGlobalLocationBySlug(slug, options)
}

async function getGlobalLocationsByIds(ids, options = {}) {
  const search = await import('./global-location-search')
  return search.getGlobalLocationsByIds(ids, options)
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
    host: null,
    related_ids: Array.isArray(row.related_ids)
      ? [...new Set(row.related_ids.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 4)
      : []
  }
}

async function indexedSimilar(location, supabase = null) {
  const relatedIds = (Array.isArray(location?.related_ids) ? location.related_ids : [])
    .filter((id) => String(id) !== String(location?.id))
    .slice(0, 3)
  if (!relatedIds.length) return []
  const rows = await getGlobalLocationsByIds(relatedIds)
  const candidates = supabase ? await filterModeratedLocationRows(supabase, rows) : rows
  return candidates.slice(0, 3).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary || row.description || null,
    kind: row.category,
    city: row.city,
    cover_url: openPhotoUrlForHash(row.primary_photo?.content_hash),
    content_kind: 'place'
  }))
}

async function loadPublicLocation(slug) {
  const traceId = createTraceId()
  const started = latencyStart()
  try {
    const row = await getGlobalLocationBySlug(slug, { traceId })
    if (!row) {
      recordSloObservation('locationDetail', elapsedMs(started), true, { trace_id: traceId, service: 'vercel', serving_mode: 'b2' })
      return null
    }
    const publicSupabase = isSupabaseConfigured() ? createPublicClient() : null
    const location = globalLocationShape(row)
    const suspended = publicSupabase ? await isLocationSuspended(publicSupabase, row.id) : false
    if (suspended) {
      recordSloObservation('locationDetail', elapsedMs(started), true, { trace_id: traceId, service: 'vercel', serving_mode: 'b2', moderated: true })
      return null
    }
    recordSloObservation('locationDetail', elapsedMs(started), true, { trace_id: traceId, service: 'vercel', serving_mode: 'b2' })
    return { location, similar: [] }
  } catch (error) {
    recordSloObservation('locationDetail', elapsedMs(started), false, { trace_id: traceId, service: 'vercel', serving_mode: 'b2' })
    throw error
  }
}

const cachedPublicLocation = unstable_cache(loadPublicLocation, ['public-location-v7'], { revalidate: 3600, tags: ['public-locations'] })
const publicLocationInFlight = new Map()

export async function getCachedPublicLocation(slug) {
  const key = String(slug || '').trim()
  const active = publicLocationInFlight.get(key)
  if (active) return active
  const promise = cachedPublicLocation(key)
  publicLocationInFlight.set(key, promise)
  try {
    return await promise
  } finally {
    if (publicLocationInFlight.get(key) === promise) publicLocationInFlight.delete(key)
  }
}

async function loadPublicLocationRecommendations(slug) {
  const result = await getCachedPublicLocation(slug)
  if (!result?.location) return []
  const publicSupabase = isSupabaseConfigured() ? createPublicClient() : null
  const similar = await indexedSimilar(result.location, publicSupabase)
  return similar.slice(0, 6)
}

const cachedPublicLocationRecommendations = unstable_cache(
  loadPublicLocationRecommendations,
  ['public-location-recommendations-v2'],
  { revalidate: 3600, tags: ['public-location-recommendations'] }
)
const recommendationInFlight = new Map()

export async function getCachedPublicLocationRecommendations(slug) {
  const key = String(slug || '').trim()
  const active = recommendationInFlight.get(key)
  if (active) return active
  const promise = cachedPublicLocationRecommendations(key)
  recommendationInFlight.set(key, promise)
  try {
    return await promise
  } finally {
    if (recommendationInFlight.get(key) === promise) recommendationInFlight.delete(key)
  }
}
