import { createAdminClient } from '../lib/supabase/admin.js'
import { b2Configuration } from '../lib/app/b2-s3.js'
import {
  detailObjectKey,
  provenanceObjectKey,
  tileObjectKey
} from '../lib/app/static-catalogue.js'
import { isEnrichmentStateSettled } from '../lib/app/static-catalogue-launch.js'
import {
  listAllB2Objects,
  loadStaticReleasePlan,
  readStaticEnrichmentTile,
  readStaticReleaseTile,
  statusForLocation
} from '../lib/app/static-catalogue-release.js'

const argv = process.argv.slice(2)
const FAIL_ON_INCOMPLETE = argv.includes('--fail-on-incomplete')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim() || null
const config = b2Configuration()
if (!config) throw new Error('Backblaze B2 credentials are required.')

function chunks(values, size = 200) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function relation(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function assetsFor(admin, ids) {
  const rows = []
  for (const values of chunks(ids)) {
    const result = await admin
      .from('static_location_assets')
      .select('static_location_id,photo_provider,external_photo_id,attribution_text,attribution_url,license_code,terms_url,google_place_id,google_match_score,media_objects(storage_key,public_url,byte_size)')
      .in('static_location_id', values)
    if (result.error) throw result.error
    rows.push(...(result.data || []))
  }
  return new Map(rows.map((row) => [String(row.static_location_id), row]))
}

function addCount(map, key, amount = 1) {
  const normalized = String(key || 'unknown')
  map.set(normalized, (map.get(normalized) || 0) + amount)
}

const admin = createAdminClient()
const plan = await loadStaticReleasePlan({ release: RELEASE, config })
const [catalogueObjects, photoObjects] = await Promise.all([
  listAllB2Objects('catalogue/', { config }),
  listAllB2Objects('photos/open/', { config })
])
const catalogueObjectMap = new Map(catalogueObjects.map((object) => [object.key, object]))
const photoObjectMap = new Map(photoObjects.map((object) => [object.key, object]))
const countsByMarket = new Map()
const countsByCategory = new Map()
const missingObjects = new Set()
const sparseTiles = []
const totals = {
  acceptedLocations: 0,
  duplicatesRemoved: Number(plan.releaseManifest.duplicatesRemoved || 0),
  openPhotoMatches: 0,
  googleOnlyMatches: 0,
  placeholderOnlyCards: 0,
  unsettledPhotoAttempts: 0,
  unsettledGoogleAttempts: 0,
  missingAttribution: 0,
  missingLicences: 0
}

for (const tileDescriptor of plan.tiles) {
  const tile = { z: tileDescriptor.z, x: tileDescriptor.x, y: tileDescriptor.y }
  for (const key of [
    tileObjectKey(plan.release, tile),
    detailObjectKey(plan.release, tile),
    provenanceObjectKey(plan.release, tile)
  ]) {
    if (!catalogueObjectMap.has(key)) missingObjects.add(key)
  }

  const [{ places }, enrichment] = await Promise.all([
    readStaticReleaseTile(plan.release, tileDescriptor, { config }),
    readStaticEnrichmentTile(plan.release, tileDescriptor, { config })
  ])
  if (places.length < 12) sparseTiles.push({ key: tileDescriptor.key, eligibleLocations: places.length })
  totals.acceptedLocations += places.length
  const assets = await assetsFor(admin, places.map((place) => place.staticLocationId))

  for (const place of places) {
    addCount(countsByCategory, place.kind)
    const markets = Array.isArray(place.sourceMetadata?.launchPartitions) && place.sourceMetadata.launchPartitions.length
      ? place.sourceMetadata.launchPartitions
      : ['unassigned']
    for (const market of markets) addCount(countsByMarket, market)

    const asset = assets.get(place.staticLocationId) || null
    const media = relation(asset?.media_objects)
    const hasPhoto = Boolean(media?.storage_key)
    const hasGoogle = Boolean(asset?.google_place_id)
    const status = statusForLocation(enrichment.statuses, place.staticLocationId)
    const photoSettled = isEnrichmentStateSettled(status.photoState)
    const googleSettled = isEnrichmentStateSettled(status.googleState)

    if (hasPhoto) {
      totals.openPhotoMatches += 1
      if (!asset.attribution_text || !asset.attribution_url) totals.missingAttribution += 1
      if (!asset.license_code || !asset.terms_url) totals.missingLicences += 1
      if (!photoObjectMap.has(media.storage_key)) missingObjects.add(media.storage_key)
    } else if (hasGoogle) {
      totals.googleOnlyMatches += 1
    } else if (photoSettled && googleSettled) {
      totals.placeholderOnlyCards += 1
    }

    if (!photoSettled) totals.unsettledPhotoAttempts += 1
    if (!googleSettled) totals.unsettledGoogleAttempts += 1
  }
}

const databaseSize = await admin.rpc('static_catalogue_launch_database_bytes_v1')
if (databaseSize.error) throw databaseSize.error
const databaseBytes = Number(Array.isArray(databaseSize.data) ? databaseSize.data[0] : databaseSize.data || 0)
const result = {
  release: plan.release,
  ...totals,
  countsByMarket: Object.fromEntries([...countsByMarket.entries()].sort(([a], [b]) => a.localeCompare(b))),
  countsByCategory: Object.fromEntries([...countsByCategory.entries()].sort(([a], [b]) => a.localeCompare(b))),
  missingB2Objects: missingObjects.size,
  missingB2ObjectSamples: [...missingObjects].slice(0, 50),
  tilesWithFewerThan12EligibleLocations: sparseTiles.length,
  sparseTileSamples: sparseTiles.slice(0, 50),
  b2CatalogueBytes: catalogueObjects.reduce((sum, object) => sum + Number(object.bytes || 0), 0),
  b2PhotoBytes: photoObjects.reduce((sum, object) => sum + Number(object.bytes || 0), 0),
  supabaseDatabaseBytes: databaseBytes,
  complete: totals.unsettledPhotoAttempts === 0 &&
    totals.unsettledGoogleAttempts === 0 &&
    totals.missingAttribution === 0 &&
    totals.missingLicences === 0 &&
    missingObjects.size === 0
}
console.log(JSON.stringify(result, null, 2))
if (FAIL_ON_INCOMPLETE && !result.complete) process.exitCode = 1
