import { createAdminClient } from '../supabase/admin.js'
import { getDiscoveryFeed, parseDiscoveryFilters } from './discovery.js'
import { openPlaceRpcPayload } from './open-place-catalogue.js'
import { categoryPlaceholderUrl, fetchNearbyStaticPlaces, staticCatalogueBaseUrl } from './static-catalogue.js'

function chunk(values, size = 100) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function locationIds(items = []) {
  return [...new Set(items.filter((item) => item?.content_kind === 'place' && item?.content_id).map((item) => item.content_id))]
}

async function existingSourceIds(admin, source, sourceIds) {
  const existing = new Set()
  for (const values of chunk(sourceIds, 100)) {
    const result = await admin
      .from('location_source_links')
      .select('source_place_id')
      .eq('source', source)
      .in('source_place_id', values)
    if (result.error) throw result.error
    for (const row of result.data || []) existing.add(row.source_place_id)
  }
  return existing
}

export async function materializeStaticCatalogueNear(session, rawFilters = {}) {
  const baseUrl = staticCatalogueBaseUrl()
  if (!baseUrl) return { enabled: false, fetched: 0, materialized: 0, release: null, tilesLoaded: 0 }
  const filters = parseDiscoveryFilters(rawFilters, session.profile?.search_radius_km || 25)
  const latitude = Number(filters.latitude ?? session.profile?.latitude)
  const longitude = Number(filters.longitude ?? session.profile?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { enabled: true, fetched: 0, materialized: 0, release: null, tilesLoaded: 0 }
  }

  const limit = Math.max(12, Math.min(200, Number(process.env.STATIC_CATALOGUE_MATERIALIZE_LIMIT || Math.max(filters.limit * 6, 72))))
  const nearby = await fetchNearbyStaticPlaces({
    latitude,
    longitude,
    radiusKm: filters.distance,
    limit,
    baseUrl
  })
  if (!nearby.places.length) {
    return {
      enabled: true,
      fetched: 0,
      materialized: 0,
      release: nearby.manifest?.release || null,
      tilesLoaded: nearby.tilesLoaded
    }
  }

  const admin = createAdminClient()
  let materialized = 0
  const grouped = Map.groupBy(nearby.places, (place) => place.source)
  for (const [source, places] of grouped) {
    if (!['overture', 'fsq_os'].includes(source)) continue
    const sourceIds = places.map((place) => place.sourcePlaceId)
    const existing = await existingSourceIds(admin, source, sourceIds)
    const missing = places.filter((place) => !existing.has(place.sourcePlaceId))
    for (const values of chunk(missing, 75)) {
      const result = await admin.rpc('upsert_open_catalogue_batch_v1', {
        import_source: source,
        payloads: values.map((place) => openPlaceRpcPayload(place, {
          releaseId: nearby.manifest?.release || null,
          regionId: null
        }))
      })
      if (result.error) throw result.error
      materialized += values.length
    }
  }

  return {
    enabled: true,
    fetched: nearby.places.length,
    materialized,
    release: nearby.manifest?.release || null,
    tilesLoaded: nearby.tilesLoaded,
    tilesRequested: nearby.tilesRequested
  }
}

async function googlePlaceIds(session, items) {
  const ids = locationIds(items)
  if (!ids.length) return new Map()
  const rows = []
  for (const values of chunk(ids, 100)) {
    const result = await session.supabase
      .from('location_google_places')
      .select('location_id,google_place_id,match_score')
      .eq('status', 'verified')
      .in('location_id', values)
    if (result.error) return new Map()
    rows.push(...(result.data || []))
  }
  return new Map(rows.map((row) => [row.location_id, row]))
}

export async function enhanceDiscoveryFeedInfrastructure(session, feed, staticState = null) {
  const mappings = await googlePlaceIds(session, feed.items || [])
  const indexed = (feed.items || []).map((item, index) => {
    const mapping = item.content_kind === 'place' ? mappings.get(item.content_id) : null
    const hasCachedPhoto = Boolean(item.photo_url || item.cover_url || item.has_real_photo)
    return {
      ...item,
      google_place_id: mapping?.google_place_id || null,
      google_place_match_score: mapping ? Number(mapping.match_score) : null,
      category_placeholder_url: categoryPlaceholderUrl(item.category),
      photo_priority: hasCachedPhoto ? 2 : mapping?.google_place_id ? 1 : 0,
      __original_index: index
    }
  })
  indexed.sort((a, b) =>
    Number(b.card_tier || 0) - Number(a.card_tier || 0)
    || Number(b.photo_priority || 0) - Number(a.photo_priority || 0)
    || Number(b.score || 0) - Number(a.score || 0)
    || a.__original_index - b.__original_index
  )
  const items = indexed.map(({ __original_index, ...item }) => item)
  return {
    ...feed,
    items,
    infrastructure: {
      catalogue: staticState?.enabled ? 'r2-static' : 'supabase-fallback',
      staticRelease: staticState?.release || null,
      staticFetched: Number(staticState?.fetched || 0),
      staticMaterialized: Number(staticState?.materialized || 0),
      staticTilesLoaded: Number(staticState?.tilesLoaded || 0),
      googleUiKitEligible: items.filter((item) => !item.photo_url && Boolean(item.google_place_id)).length
    }
  }
}

export async function getInfrastructureDiscoveryFeed(session, rawFilters = {}) {
  let staticState = { enabled: Boolean(staticCatalogueBaseUrl()), fetched: 0, materialized: 0, release: null, tilesLoaded: 0 }
  try {
    staticState = await materializeStaticCatalogueNear(session, rawFilters)
  } catch (error) {
    console.warn(`Static catalogue fallback failed: ${error.message}`)
    staticState = { ...staticState, error: error.message }
  }
  const feed = await getDiscoveryFeed(session, rawFilters)
  return enhanceDiscoveryFeedInfrastructure(session, feed, staticState)
}
