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
// The catalogue ranks by relevance and exposes no offset, so paging happens over one deep
// fetch that every page of a hub shares from cache rather than one query per page.
const HUB_CANDIDATE_LIMIT = 480
export const HUB_PAGE_SIZE = 24
export const HUB_MAX_PAGES = 10
// Google's March 2026 scaled-content enforcement targets templated pages that carry no real
// content of their own. A hub holding one or two listings is mostly boilerplate, so it stays
// crawlable for its links but out of the index until the catalogue fills it in.
export const HUB_MIN_INDEXABLE = 3

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
    bbox,
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

const categoriesByKind = new Map(PLACE_CATEGORIES.map((category) => [category.kind, category]))

export function categoryLabelForKind(kind) {
  const category = categoriesByKind.get(String(kind || '').trim())
  if (category) return category.singular.replace(/\b\w/, (letter) => letter.toUpperCase())
  return String(kind || 'Place').replaceAll('_', ' ').replace(/\b\w/, (letter) => letter.toUpperCase())
}

function shapeHubPlace(row) {
  const photo = row?.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
  const neighborhood = row.neighborhood || null
  const city = row.city || null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary || row.description || null,
    kind: row.category || row.kind || 'place',
    city,
    // A grid of names and cities is the same shape on every hub. Neighbourhood and category are
    // per-place facts the catalogue already returns, and they are what makes one listing
    // distinguishable from the next to a reader and to a crawler.
    neighborhood,
    area: [neighborhood, city].filter(Boolean).join(', ') || null,
    categoryLabel: categoryLabelForKind(row.category || row.kind),
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
      candidateLimit: HUB_CANDIDATE_LIMIT,
      // Cards without a photo read as broken and give a crawler nothing to weigh, so the
      // catalogue's photo-first ranking is worth the reshuffle.
      preferPhoto: true
    })
    const candidates = Array.isArray(result?.candidates) ? result.candidates : []
    const publicSupabase = isSupabaseConfigured() ? createPublicClient() : null
    const visible = publicSupabase ? await filterModeratedLocationRows(publicSupabase, candidates) : candidates
    return visible
      .filter((row) => row?.slug && row?.name)
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

// A place page knows its coordinates but not which hub lists it. Matching on the city string
// would miss every suburb that sits inside a metro but does not share its name, so the lookup
// is a point-in-bounding-box test against the same markets the hubs are built from. Smaller
// markets win ties, which keeps a place in the most specific hub whose box contains it.
export function findMarketForPoint(latitude, longitude) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  let best = null
  let bestArea = Infinity
  for (const market of MARKETS) {
    const [west, south, east, north] = market.bbox
    if (lon < west || lon > east || lat < south || lat > north) continue
    const area = Math.abs(east - west) * Math.abs(north - south)
    if (area < bestArea) {
      best = market
      bestArea = area
    }
  }
  return best
}

export function marketPath(market, category = null) {
  const base = `/places/in/${encodeURIComponent(typeof market === 'string' ? market : market.id)}`
  if (!category) return base
  return `${base}/${encodeURIComponent(typeof category === 'string' ? category : category.slug)}`
}

export function totalHubPages(total) {
  if (!total) return 1
  return Math.max(1, Math.min(HUB_MAX_PAGES, Math.ceil(total / HUB_PAGE_SIZE)))
}

export function hubPageNumber(value) {
  const parsed = Number.parseInt(String(value ?? '1'), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(HUB_MAX_PAGES, parsed)
}

// One cached fetch backs every page of a hub, so paging is a slice rather than a new query.
export function paginateHubPlaces(places, page) {
  const all = Array.isArray(places) ? places : []
  const totalPages = totalHubPages(all.length)
  const current = Math.min(hubPageNumber(page), totalPages)
  const start = (current - 1) * HUB_PAGE_SIZE
  return {
    items: all.slice(start, start + HUB_PAGE_SIZE),
    page: current,
    totalPages,
    total: Math.min(all.length, HUB_PAGE_SIZE * HUB_MAX_PAGES),
    prevPage: current > 1 ? current - 1 : null,
    nextPage: current < totalPages ? current + 1 : null
  }
}

function listSentence(values) {
  const parts = values.filter(Boolean)
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Every hub shares one sentence template, which reads as boilerplate at 400+ pages. Naming real
// places and counts makes each page describe its own contents instead.
export function describeHubPlaces(places, { market, category } = {}) {
  const all = Array.isArray(places) ? places : []
  if (!all.length) return ''
  // The catalogue lookup returns a deeper list than the hub can page through, so counting the
  // raw result advertised places no reader could reach: a hub claiming 480 parks stopped at 240.
  // Every number here describes the reachable set instead.
  const reachable = all.slice(0, HUB_PAGE_SIZE * HUB_MAX_PAGES)
  const named = listSentence(reachable.slice(0, 3).map((place) => place.name))
  const singular = category ? category.singular : 'place'
  const plural = category ? category.label.toLowerCase() : 'places'
  const noun = reachable.length === 1 ? singular : plural
  const where = market ? ` around ${market.name}` : ''
  const rest = reachable.length > 3 ? `, plus ${reachable.length - 3} more` : ''
  const withPhotos = reachable.filter((place) => place.coverUrl).length
  const photoNote = withPhotos >= 3 ? ` ${withPhotos} of them have photos.` : ''
  return `Includes ${named}${rest}. Puddle tracks ${reachable.length} ${noun}${where}.${photoNote}`
}
