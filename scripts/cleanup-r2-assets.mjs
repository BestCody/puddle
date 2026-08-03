import { createAdminClient } from '../lib/supabase/admin.js'
import { deleteR2Object, listR2Objects, r2Configuration } from '../lib/app/r2-s3.js'
import { syncStaticMediaOverlayForLocations } from '../lib/app/static-media-overlay.js'

const APPLY = process.argv.includes('--apply')
const KEEP_RELEASES = Math.max(1, Math.min(10, Number(process.env.R2_RELEASES_TO_KEEP || 2)))
const PHOTO_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.R2_PHOTO_CLEANUP_LIMIT || 500)))
const LOCATION_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.STATIC_LOCATION_CLEANUP_LIMIT || 500)))
const config = r2Configuration()
if (!config) throw new Error('R2 credentials are required.')

async function allObjects(prefix) {
  const objects = []
  let token = null
  do {
    const page = await listR2Objects(prefix, { config, continuationToken: token })
    objects.push(...page.objects)
    token = page.truncated ? page.nextContinuationToken : null
  } while (token)
  return objects
}

const releaseObjects = await allObjects('catalogue/releases/')
const releases = [...new Set(releaseObjects.map((object) => object.key.split('/')[2]).filter(Boolean))].sort().reverse()
const staleReleases = new Set(releases.slice(KEEP_RELEASES))
const staleObjects = releaseObjects.filter((object) => staleReleases.has(object.key.split('/')[2]))

const admin = createAdminClient()
const expired = await admin
  .from('location_photo_sources')
  .select('id,location_id,media_object_id,status,expires_at')
  .not('media_object_id', 'is', null)
  .or(`status.in.(rejected,archived),expires_at.lt.${new Date().toISOString()}`)
  .limit(PHOTO_LIMIT)
if (expired.error) throw expired.error

const cold = await admin
  .from('static_catalogue_materializations')
  .select('location_id,expires_at,retention_class')
  .lt('expires_at', new Date().toISOString())
  .limit(LOCATION_LIMIT)
if (cold.error) throw cold.error

let deletedObjects = 0
let deletedRows = 0
let deletedLocations = 0
for (const object of staleObjects) {
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} stale catalogue object ${object.key}.`)
  if (APPLY) {
    await deleteR2Object(object.key, { config })
    deletedObjects += 1
  }
}

const mediaIds = [...new Set((expired.data || []).map((row) => row.media_object_id).filter(Boolean))]
if (APPLY && expired.data?.length) {
  const result = await admin.from('location_photo_sources').delete().in('id', expired.data.map((row) => row.id))
  if (result.error) throw result.error
  deletedRows += expired.data.length
  await syncStaticMediaOverlayForLocations(admin, [...new Set(expired.data.map((row) => row.location_id).filter(Boolean))], { config })
}
for (const mediaId of mediaIds) {
  const references = await admin
    .from('location_photo_sources')
    .select('id', { count: 'exact', head: true })
    .eq('media_object_id', mediaId)
  if (references.error) throw references.error
  if (Number(references.count || 0) > 0) continue
  const media = await admin.from('media_objects').select('storage_backend,storage_key').eq('id', mediaId).maybeSingle()
  if (media.error && media.error.code !== 'PGRST116') throw media.error
  if (!media.data) continue
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} unreferenced media object ${media.data.storage_key}.`)
  if (APPLY) {
    if (media.data.storage_backend === 'r2') await deleteR2Object(media.data.storage_key, { config })
    const removed = await admin.from('media_objects').delete().eq('id', mediaId)
    if (removed.error) throw removed.error
    deletedObjects += 1
  }
}

for (const materialization of cold.data || []) {
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} cold materialized location ${materialization.location_id} (${materialization.retention_class}).`)
  if (!APPLY) continue
  const result = await admin.rpc('delete_cold_static_materialization_v1', { target_location: materialization.location_id })
  if (result.error) throw result.error
  if (result.data === true) deletedLocations += 1
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  releasesFound: releases.length,
  releasesKept: releases.slice(0, KEEP_RELEASES),
  staleReleaseObjects: staleObjects.length,
  expiredPhotoRows: expired.data?.length || 0,
  coldMaterializations: cold.data?.length || 0,
  deletedObjects,
  deletedRows,
  deletedLocations
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the deletion plan.')
