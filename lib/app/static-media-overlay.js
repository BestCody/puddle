import { chooseLocationPhoto } from './place-photos.js'
import { putR2Object, r2Configuration, r2Request } from './r2-s3.js'
import {
  fetchStaticCatalogueManifest,
  lonLatToTile,
  mediaOverlayObjectKey,
  staticCatalogueSchema
} from './static-catalogue.js'

function chunk(values, size = 250) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function rowsFor(admin, table, columns, ids) {
  const rows = []
  for (const values of chunk(ids)) {
    const result = await admin.from(table).select(columns).in('location_id', values)
    if (result.error) throw result.error
    rows.push(...(result.data || []))
  }
  return rows
}

async function readOverlay(key, config) {
  const response = await r2Request({ method: 'GET', key, config })
  if (response.status === 404) return { v: staticCatalogueSchema.mediaVersion, m: [] }
  if (!response.ok) throw new Error(`R2 media overlay read failed for ${key}: ${response.status}`)
  const payload = await response.json()
  return {
    v: staticCatalogueSchema.mediaVersion,
    m: Array.isArray(payload?.m) ? payload.m : []
  }
}

function overlayRecord(locationId, photo, google) {
  if (!photo && !google) return null
  return [
    locationId,
    photo?.remote_url || null,
    photo?.provider || null,
    photo?.attribution_text || null,
    photo?.attribution_url || null,
    photo?.license_code || null,
    google?.google_place_id || null,
    google?.match_score === null || google?.match_score === undefined ? null : Number(google.match_score)
  ]
}

export async function syncStaticMediaOverlayForLocations(admin, locationIds, {
  config = r2Configuration(),
  zoom = null
} = {}) {
  const ids = [...new Set((locationIds || []).map(String).filter(Boolean))]
  if (!ids.length) return { locations: 0, tiles: 0, records: 0 }
  if (!admin) throw new Error('An administrative Supabase client is required.')
  if (!config?.publicBaseUrl) throw new Error('R2 credentials and R2_PUBLIC_BASE_URL are required.')

  const locationRows = []
  for (const values of chunk(ids)) {
    const result = await admin
      .from('locations')
      .select('id,latitude,longitude')
      .in('id', values)
    if (result.error) throw result.error
    locationRows.push(...(result.data || []))
  }
  const locationIdSet = new Set(locationRows.map((row) => row.id))
  if (!locationIdSet.size) return { locations: 0, tiles: 0, records: 0 }

  const [links, photos, googleRows] = await Promise.all([
    rowsFor(admin, 'location_source_links', 'location_id,source,source_place_id', [...locationIdSet]),
    rowsFor(admin, 'location_photo_sources', 'id,location_id,remote_url,provider,attribution_text,attribution_url,license_code,status,is_ai_generated,is_primary,sort_order,verified_at,expires_at', [...locationIdSet]),
    rowsFor(admin, 'location_google_places', 'location_id,google_place_id,status,match_score', [...locationIdSet])
  ])
  const staticIds = new Set(links.filter((row) => ['overture', 'fsq_os'].includes(row.source)).map((row) => row.location_id))
  const photosByLocation = new Map()
  for (const row of photos) {
    if (!photosByLocation.has(row.location_id)) photosByLocation.set(row.location_id, [])
    photosByLocation.get(row.location_id).push(row)
  }
  const googleByLocation = new Map(googleRows.filter((row) => row.status === 'verified' && row.google_place_id).map((row) => [row.location_id, row]))
  let catalogueZoom = Number(zoom)
  if (!Number.isInteger(catalogueZoom)) {
    const manifest = await fetchStaticCatalogueManifest({ baseUrl: config.publicBaseUrl }).catch(() => null)
    catalogueZoom = Number.isInteger(Number(manifest?.zoom)) ? Number(manifest.zoom) : Number(process.env.STATIC_CATALOGUE_ZOOM || staticCatalogueSchema.defaultZoom)
  }

  const grouped = new Map()
  for (const location of locationRows) {
    if (!staticIds.has(location.id)) continue
    const latitude = Number(location.latitude)
    const longitude = Number(location.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    const tile = lonLatToTile(longitude, latitude, catalogueZoom)
    const key = mediaOverlayObjectKey(tile)
    if (!grouped.has(key)) grouped.set(key, { tile, updates: new Map() })
    const photo = chooseLocationPhoto(photosByLocation.get(location.id) || [])
    const google = googleByLocation.get(location.id) || null
    grouped.get(key).updates.set(location.id, overlayRecord(location.id, photo, google))
  }

  let records = 0
  for (const [key, group] of grouped) {
    const current = await readOverlay(key, config)
    const map = new Map(current.m.filter((row) => Array.isArray(row) && row[0]).map((row) => [String(row[0]), row]))
    for (const [locationId, record] of group.updates) {
      if (record) map.set(locationId, record)
      else map.delete(locationId)
    }
    const payload = {
      v: staticCatalogueSchema.mediaVersion,
      updatedAt: new Date().toISOString(),
      m: [...map.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    }
    await putR2Object(key, Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
      config
    })
    records += payload.m.length
  }

  return { locations: staticIds.size, tiles: grouped.size, records }
}
