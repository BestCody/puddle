import { createAdminClient } from '../lib/supabase/admin.js'
import { deleteR2Object, listR2Objects, r2Configuration } from '../lib/app/r2-s3.js'

const APPLY = process.argv.includes('--apply')
const KEEP_RELEASES = Math.max(1, Math.min(10, Number(process.env.R2_RELEASES_TO_KEEP || 2)))
const PHOTO_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.R2_PHOTO_CLEANUP_LIMIT || 500)))
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
  .select('id,storage_key,status,expires_at')
  .eq('storage_backend', 'r2')
  .not('storage_key', 'is', null)
  .or(`status.in.(rejected,archived),expires_at.lt.${new Date().toISOString()}`)
  .limit(PHOTO_LIMIT)
if (expired.error) throw expired.error

let deleted = 0
for (const object of staleObjects) {
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} stale catalogue object ${object.key}.`)
  if (APPLY) {
    await deleteR2Object(object.key, { config })
    deleted += 1
  }
}
for (const photo of expired.data || []) {
  const references = await admin
    .from('location_photo_sources')
    .select('id', { count: 'exact', head: true })
    .eq('storage_backend', 'r2')
    .eq('storage_key', photo.storage_key)
    .neq('id', photo.id)
  if (references.error) throw references.error
  const shared = Number(references.count || 0) > 0
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} expired photo row ${photo.id}${shared ? ' while retaining its shared R2 object' : ` and unreferenced object ${photo.storage_key}`}.`)
  if (APPLY) {
    const result = await admin.from('location_photo_sources').delete().eq('id', photo.id)
    if (result.error) throw result.error
    if (!shared) await deleteR2Object(photo.storage_key, { config })
    deleted += 1
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  releasesFound: releases.length,
  releasesKept: releases.slice(0, KEEP_RELEASES),
  staleReleaseObjects: staleObjects.length,
  expiredPhotos: expired.data?.length || 0,
  deleted
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the deletion plan.')
