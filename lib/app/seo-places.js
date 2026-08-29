import { unstable_cache } from 'next/cache'
import launchMarkets from '@/config/launch-markets.json'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { filterModeratedLocationRows } from './location-moderation-overlay'
import { isGlobalLocationSearchConfigured, searchGlobalLocations } from './global-location-search'

// Public discovery hubs are the only crawlable path into /places/[slug]. Every helper here
// degrades to an empty list instead of throwing so a cold or unconfigured B2 catalogue still
// renders a linkable page rather than a 500.

const EARTH_KM_PER_DEGREE = 111.32
const MIN_HUB_RADIUS_KM = 10
// Matches the ceiling the similar-places lookup already relies on, so hub queries stay inside
// the shard budget the B2 catalogue is tuned for.
const MAX_HUB_RADIUS_KM = 50
const HUB_CANDIDATE_LIMIT = 48
const HUB_PLACE_LIMIT = 24

export const PLACE_CATEGORIES = [
  { slug: 'coffee-shops', kind: 'cafe', label: 'Coffee shops', singular: 'coffee shop' },
  { slug: 'restaurants', kind: 'restaurant', label: 'Restaurants', singular: 'restaurant' },
  { slug: 'bars', kind: 'bar', label: 'Bars', singular: 'bar' },
  { slug: 'parks', kind: 'park', label: 'Parks', singular: 'park' },
  { slug: 'museums', kind: 'museum', label: 'Museums', singular: 'museum' },
  { slug: 'galleries', kind: 'gallery', label: 'Galleries', singular: 'gallery' },
  { slug: 'attractions', kind: 'attraction', label: 'Attractions', singular: 'attraction' },
  { slug: 'activities', kind: 'activity_venue', label: 'Activities', singular: 'activity venue' },
  { slug: 'scenic-spots', kind: 'scenic_spot', label: 'Scenic spots', singular: 'scenic spot' },
  { slug: 'nightlife', kind: 'nightlife', label: 'Nightlife', singular: 'nightlife spot' },
  { slug: 'shops', kind: 'shop', label: 'Shops', singular: 'shop' },
  { slug: 'community-spaces', kind: 'community_space', label: 'Community spaces', singular: 'community space' }
]

const categoriesBySlug = new Map(PLACE_CATEGORIES.map((category) => [category.slug, category]))

function marketRadiusKm(bbox) {
  const [west, south, east, north] = bbox
  const latSpanKm = Math.abs(north - south) * EARTH_KM_PER_DEGREE
  const midLatRadians = ((north + south) / 2) * (Math.PI / 180)
  const lonSpanKm = Math.abs(east - west) * EARTH_KM_PER_DEGREE * Math.cos(midLatRadians)
  const halfSpan = Math.max(latSpanKm, lonSpanKm) / 2
  return Math.min(MAX_HUB_RADIUS_KM, Math.max(MIN_HUB_RADIUS_KM, Math.round(halfSpan)))
}

function shapeMarket(entry) {
  const bbox = Array.isArray(entry?.bbox) && entry.bbox.length === 4 ? entry.bbox.map(Number) : null
  if (!bbox || bbox.some((value) => !Number.isFinite(value))) return null
  const [west, south, east, north] = bbox
  return {
    id: String(entry.id),
    name: String(entry.name),
    country: String(entry.country || ''),
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 99,
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    radiusKm: marketRadiusKm(bbox)
  }
}

const MARKETS = (Array.isArray(launchMarkets?.markets) ? launchMarkets.markets : [])
  .map(shapeMarket)
  .filter(Boolean)
  .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

const marketsById = new Map(MARKETS.map((market) => [market.id, market]))

export function listMarkets() {
  return MARKETS
}

export function getMarket(id) {
  return marketsById.get(String(id || '').trim()) || null
}

export function getCategory(slug) {
  return categoriesBySlug.get(String(slug || '').trim()) || null
}

export function marketRegionLabel(market) {
  if (!market) return ''
  return market.country === 'CA' ? 'Canada' : market.country === 'US' ? 'United States' : market.country
}

function shapeHubPlace(row) {
  const photo = row?.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary || row.description || null,
    kind: row.category || row.kind || 'place',
    city: row.city || null,
    coverUrl: openPhotoUrlForHash(photo.content_hash)
  }
}

async function loadMarketPlaces(marketId, categorySlug) {
  const market = getMarket(marketId)
  if (!market) return []
  if (!isGlobalLocationSearchConfigured()) return []
  const category = categorySlug ? getCategory(categorySlug) : null
  if (categorySlug && !category) return []

  try {
    const result = await searchGlobalLocations({
      latitude: market.latitude,
      longitude: market.longitude,
      distanceKm: market.radiusKm,
      filters: category ? { category: category.kind } : {},
      candidateLimit: HUB_CANDIDATE_LIMIT
    })
    const candidates = Array.isArray(result?.candidates) ? result.candidates : []
    const publicSupabase = isSupabaseConfigured() ? createPublicClient() : null
    const visible = publicSupabase ? await filterModeratedLocationRows(publicSupabase, candidates) : candidates
    return visible
      .filter((row) => row?.slug && row?.name)
      .slice(0, HUB_PLACE_LIMIT)
      .map(shapeHubPlace)
  } catch {
    // A hub that lists nothing still gives crawlers its category and market links, which is the
    // point of the page. Surfacing the catalogue error instead would remove that path entirely.
    return []
  }
}

const cachedMarketPlaces = unstable_cache(loadMarketPlaces, ['seo-market-places-v1'], {
  revalidate: 3600,
  tags: ['public-locations']
})

export async function getCachedMarketPlaces(marketId, categorySlug = null) {
  return cachedMarketPlaces(String(marketId || '').trim(), categorySlug ? String(categorySlug).trim() : null)
}

export function marketPath(market, category = null) {
  const base = `/places/in/${encodeURIComponent(typeof market === 'string' ? market : market.id)}`
  if (!category) return base
  return `${base}/${encodeURIComponent(typeof category === 'string' ? category : category.slug)}`
}
