import { createAdminClient } from '../lib/supabase/admin.js'
import { deleteB2Object, listB2Objects, b2Configuration, b2Request } from '../lib/app/b2-s3.js'
import { syncStaticMediaOverlayForLocations } from '../lib/app/static-media-overlay.js'

const APPLY = process.argv.includes('--apply')
const KEEP_RELEASES = Math.max(1, Math.min(10, Number(process.env.B2_RELEASES_TO_KEEP || 2)))
const PHOTO_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.B2_PHOTO_CLEANUP_LIMIT || 500)))
const LOCATION_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.STATIC_LOCATION_CLEANUP_LIMIT || 500)))
const DELETE_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.B2_DELETE_CONCURRENCY || 6)))
const config = b2Configuration()
if (!config) throw new Error('Backblaze B2 credentials are required.')

async function allObjects(prefix) {
  const objects = []
  let token = null
  do {
    const page = await listB2Objects(prefix, { config, continuationToken: token })
    objects.push(...page.objects)
    token = page.truncated ? page.nextContinuationToken : null
  } while (token)
  return objects
}

async function runPool(items, worker, concurrency = DELETE_CONCURRENCY) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  }))
}

async function readRegistry() {
  const response = await b2Request({ method: 'GET', key: 'catalogue/release-registry.json', config })
  if (response.status === 404) {
    throw new Error('catalogue/release-registry.json is required before cleanup can run.')
  }
  if (!response.ok) throw new Error(`Backblaze B2 release registry read failed: ${response.status}`)
  const payload = await response.json()
  const releases = Array.isArray(payload?.releases) ? payload.releases.filter((item) => item?.release) : []
  if (!releases.length) throw new Error('catalogue/release-registry.json contains no releases.')
  return releases
}

async function updateRegistry(releases) {
  const body = Buffer.from(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), releases }))
  const response = await b2Request({
    method: 'PUT', key: 'catalogue/release-registry.json', body,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    config
  })
  if (!response.ok) throw new Error(`Backblaze B2 release registry write failed: ${response.status} ${await response.text()}`)
}

const registryReleases = await readRegistry()
const releases = [...new Set(registryReleases.map((item) => item.release))]
const staleReleases = releases.slice(KEEP_RELEASES)
const staleObjects = []
for (const release of staleReleases) {
  staleObjects.push(...await allObjects(`catalogue/releases/${release}/`))
}

const admin = createAdminClient()
// The RPC keeps its historical name because it is part of the applied database API.
const prepared = await admin.rpc('prepare_r2_cleanup_v2', {
  photo_limit: PHOTO_LIMIT,
  location_limit: LOCATION_LIMIT,
  apply_changes: APPLY
})
if (prepared.error) throw prepared.error
const plan = prepared.data || {}
const changedLocationIds = [...new Set((plan.changedLocationIds || []).filter(Boolean))]
const orphanMedia = Array.isArray(plan.orphanMedia) ? plan.orphanMedia : []

let deletedObjects = 0
let deletedMediaRows = 0
let overlays = null

for (const object of staleObjects) console.log(`${APPLY ? 'Deleting' : 'Would delete'} stale catalogue object ${object.key}.`)
for (const media of orphanMedia) console.log(`${APPLY ? 'Deleting' : 'Would delete'} unreferenced media object ${media.storageKey}.`)

if (APPLY) {
  await runPool(staleObjects, async (object) => {
    const result = await deleteB2Object(object.key, { config })
    if (result.deleted) deletedObjects += 1
  })

  await runPool(orphanMedia.filter((media) => media.storageBackend === 'b2' && media.storageKey), async (media) => {
    const result = await deleteB2Object(media.storageKey, { config })
    if (result.deleted) deletedObjects += 1
  })

  if (orphanMedia.length) {
    const removed = await admin.rpc('delete_unreferenced_media_objects_v1', {
      media_ids: orphanMedia.map((media) => media.id)
    })
    if (removed.error) throw removed.error
    deletedMediaRows = Number(removed.data || 0)
  }

  if (changedLocationIds.length) {
    overlays = await syncStaticMediaOverlayForLocations(admin, changedLocationIds, { config })
  }

  if (staleReleases.length) {
    await updateRegistry(registryReleases.filter((item) => !staleReleases.includes(item.release)))
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  provider: 'backblaze-b2',
  releasesFound: releases.length,
  releasesKept: releases.slice(0, KEEP_RELEASES),
  staleReleases,
  staleReleaseObjects: staleObjects.length,
  expiredPhotoRows: Number(plan.expiredPhotoRows || 0),
  coldMaterializations: Number(plan.coldMaterializations || 0),
  deletedLocations: Number(plan.deletedLocations || 0),
  orphanMedia: orphanMedia.length,
  deletedObjects,
  deletedMediaRows,
  overlays
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the deletion plan.')
