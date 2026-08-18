import { createHash } from 'node:crypto'
import { createAdminClient } from '../lib/supabase/admin.js'
import { OPEN_PHOTO_SUPABASE_BUCKET } from '../lib/app/open-photo-supabase.js'

const DELETE_SOURCE = process.argv.includes('--delete-source')
const BUCKET = String(process.env.OPEN_PHOTO_SUPABASE_BUCKET || OPEN_PHOTO_SUPABASE_BUCKET).trim()
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.B2_MEDIA_VALIDATION_CONCURRENCY || 16)))

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function loadPaged(buildQuery) {
  const rows = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const result = await buildQuery(offset, offset + pageSize - 1)
    if (result.error) throw result.error
    const batch = result.data || []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }
}

async function loadAudit(admin) {
  return loadPaged((from, to) => admin
    .from('location_photo_b2_migration_audit')
    .select('photo_source_id,legacy_storage_key,legacy_remote_url,legacy_content_hash,legacy_byte_size,captured_at')
    .order('photo_source_id', { ascending: true })
    .range(from, to))
}

async function loadApprovedPhotos(admin) {
  return loadPaged((from, to) => admin
    .from('location_photo_sources')
    .select('id,storage_backend,media_object_id,remote_url,status')
    .eq('status', 'approved')
    .order('id', { ascending: true })
    .range(from, to))
}

async function loadB2MediaObjects(admin) {
  return loadPaged((from, to) => admin
    .from('media_objects')
    .select('id,storage_backend,storage_key,public_url,content_hash,byte_size')
    .eq('storage_backend', 'b2')
    .order('id', { ascending: true })
    .range(from, to))
}

async function retry(label, operation) {
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === 4) break
      const delay = Math.min(8_000, 500 * (2 ** attempt))
      console.warn(`${label} failed transiently; retrying in ${delay}ms: ${error.message}`)
      await sleep(delay)
    }
  }
  throw lastError
}

async function fetchDeliveryBody(media) {
  return retry(`B2 delivery ${media.id}`, async () => {
    const response = await fetch(media.public_url, { cache: 'no-store' })
    if (!response.ok) {
      const error = new Error(`B2 delivery returned HTTP ${response.status} for ${media.storage_key}.`)
      error.status = response.status
      throw error
    }
    return Buffer.from(await response.arrayBuffer())
  })
}

async function downloadLegacy(storage, key) {
  return retry(`Legacy Supabase object ${key}`, async () => {
    const result = await storage.download(key)
    if (result.error) throw result.error
    return Buffer.from(await result.data.arrayBuffer())
  })
}

async function runWorkers(items, worker) {
  let cursor = 0
  const failures = []
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      try {
        await worker(items[index], index)
      } catch (error) {
        failures.push({ item: items[index], error: error.message })
      }
    }
  }))
  return failures
}

const admin = createAdminClient()
const storage = admin.storage.from(BUCKET)
const [auditRows, photos, mediaObjects] = await Promise.all([
  loadAudit(admin),
  loadApprovedPhotos(admin),
  loadB2MediaObjects(admin)
])

const photosById = new Map(photos.map((row) => [row.id, row]))
const mediaById = new Map(mediaObjects.map((row) => [row.id, row]))
const auditByPhotoId = new Map(auditRows.map((row) => [row.photo_source_id, row]))
const failures = []
const referencedMedia = new Map()
const knownLegacyByKey = new Map()
const unknownLegacyRows = []

for (const audit of auditRows) {
  const photo = photosById.get(audit.photo_source_id)
  if (!photo) {
    failures.push(`Audit photo ${audit.photo_source_id} is missing from location_photo_sources.`)
    continue
  }
  if (photo.storage_backend !== 'b2' || !photo.media_object_id) {
    failures.push(`Photo ${photo.id} is not attached to B2.`)
    continue
  }
  const media = mediaById.get(photo.media_object_id)
  if (!media) {
    failures.push(`Photo ${photo.id} references missing media object ${photo.media_object_id}.`)
    continue
  }
  if (!media.storage_key || !media.public_url || !/^[0-9a-f]{64}$/.test(String(media.content_hash || ''))) {
    failures.push(`Media object ${media.id} is missing canonical B2 metadata.`)
    continue
  }
  if (!Number.isFinite(Number(media.byte_size)) || Number(media.byte_size) <= 0) {
    failures.push(`Media object ${media.id} has an invalid byte size.`)
    continue
  }
  if (photo.remote_url !== media.public_url) failures.push(`Photo ${photo.id} delivery URL differs from media object ${media.id}.`)
  if (audit.legacy_content_hash && String(audit.legacy_content_hash).toLowerCase() !== String(media.content_hash).toLowerCase()) {
    failures.push(`Photo ${photo.id} audit SHA256 does not match media object ${media.id}.`)
  }
  if (audit.legacy_byte_size != null && Number(audit.legacy_byte_size) !== Number(media.byte_size)) {
    failures.push(`Photo ${photo.id} audit byte size does not match media object ${media.id}.`)
  }
  referencedMedia.set(media.id, media)
  if (audit.legacy_content_hash && audit.legacy_byte_size != null) {
    const expected = knownLegacyByKey.get(audit.legacy_storage_key)
    const value = { hash: String(audit.legacy_content_hash).toLowerCase(), bytes: Number(audit.legacy_byte_size) }
    if (expected && (expected.hash !== value.hash || expected.bytes !== value.bytes)) {
      failures.push(`Legacy key ${audit.legacy_storage_key} has conflicting audit metadata.`)
    } else {
      knownLegacyByKey.set(audit.legacy_storage_key, value)
    }
  } else {
    unknownLegacyRows.push({ audit, media })
  }
}

for (const photo of photos) {
  if (!auditByPhotoId.has(photo.id) && photo.storage_backend === 'supabase') {
    failures.push(`Approved Supabase-backed photo ${photo.id} is not represented in the migration audit.`)
  }
}

if (failures.length) {
  console.error(JSON.stringify({ phase: 'database_relationships', failures: failures.slice(0, 50), failureCount: failures.length }, null, 2))
  process.exit(1)
}

const uniqueMedia = [...referencedMedia.values()]
let deliveredBytes = 0
let deliveredObjects = 0
const deliveryFailures = await runWorkers(uniqueMedia, async (media) => {
  const body = await fetchDeliveryBody(media)
  const actualHash = sha256(body)
  if (body.length !== Number(media.byte_size)) throw new Error(`byte-size mismatch: db=${media.byte_size}, delivery=${body.length}`)
  if (actualHash !== String(media.content_hash).toLowerCase()) throw new Error(`SHA256 mismatch: db=${media.content_hash}, delivery=${actualHash}`)
  deliveredObjects += 1
  deliveredBytes += body.length
  if (deliveredObjects % 500 === 0 || deliveredObjects === uniqueMedia.length) {
    console.log(`verified B2 delivery ${deliveredObjects}/${uniqueMedia.length}`)
  }
})

if (deliveryFailures.length) {
  console.error(JSON.stringify({ phase: 'b2_delivery', failureCount: deliveryFailures.length, failures: deliveryFailures.slice(0, 20).map(({ item, error }) => ({ mediaObjectId: item.id, key: item.storage_key, error })) }, null, 2))
  process.exit(1)
}

const legacyVerificationTargets = []
for (const { audit, media } of unknownLegacyRows) {
  const known = knownLegacyByKey.get(audit.legacy_storage_key)
  if (known) {
    if (known.hash !== String(media.content_hash).toLowerCase() || known.bytes !== Number(media.byte_size)) {
      failures.push(`Legacy key ${audit.legacy_storage_key} known audit metadata conflicts with media object ${media.id}.`)
    }
  } else {
    legacyVerificationTargets.push({ audit, media })
  }
}

const uniqueUnknownLegacy = [...new Map(legacyVerificationTargets.map((entry) => [entry.audit.legacy_storage_key, entry])).values()]
const legacyFailures = await runWorkers(uniqueUnknownLegacy, async ({ audit, media }) => {
  const body = await downloadLegacy(storage, audit.legacy_storage_key)
  const actualHash = sha256(body)
  if (body.length !== Number(media.byte_size)) throw new Error(`byte-size mismatch: B2=${media.byte_size}, Supabase=${body.length}`)
  if (actualHash !== String(media.content_hash).toLowerCase()) throw new Error(`SHA256 mismatch: B2=${media.content_hash}, Supabase=${actualHash}`)
})

if (failures.length || legacyFailures.length) {
  console.error(JSON.stringify({
    phase: 'legacy_source_verification',
    failureCount: failures.length + legacyFailures.length,
    failures: [
      ...failures.slice(0, 20).map((error) => ({ error })),
      ...legacyFailures.slice(0, 20).map(({ item, error }) => ({ legacyStorageKey: item.audit.legacy_storage_key, error }))
    ]
  }, null, 2))
  process.exit(1)
}

const uniqueLegacyKeys = [...new Set(auditRows.map((row) => row.legacy_storage_key))]
const summary = {
  auditRows: auditRows.length,
  approvedPhotos: photos.length,
  referencedB2Objects: uniqueMedia.length,
  verifiedB2Objects: deliveredObjects,
  verifiedB2Bytes: deliveredBytes,
  uniqueLegacyKeys: uniqueLegacyKeys.length,
  legacyKeysRehashedBecauseAuditMetadataMissing: uniqueUnknownLegacy.length,
  deleteSource: DELETE_SOURCE,
  deletedLegacyKeys: 0
}

if (DELETE_SOURCE) {
  for (let index = 0; index < uniqueLegacyKeys.length; index += 100) {
    const batch = uniqueLegacyKeys.slice(index, index + 100)
    const result = await retry(`Supabase cleanup batch ${index / 100 + 1}`, async () => {
      const response = await storage.remove(batch)
      if (response.error) throw response.error
      return response
    })
    const removed = Array.isArray(result.data) ? result.data.length : batch.length
    if (removed !== batch.length) throw new Error(`Supabase cleanup batch removed ${removed}/${batch.length} requested objects.`)
    summary.deletedLegacyKeys += removed
    console.log(`deleted legacy Supabase objects ${summary.deletedLegacyKeys}/${uniqueLegacyKeys.length}`)
  }
}

console.log(JSON.stringify(summary, null, 2))
