import { createHash } from 'node:crypto'
import { createAdminClient } from '../lib/supabase/admin.js'
import { OPEN_PHOTO_SUPABASE_BUCKET } from '../lib/app/open-photo-supabase.js'
import { authorizeB2 } from '../lib/storage/b2-native.js'

const DELETE_SOURCE = process.argv.includes('--delete-source')
const BUCKET = String(process.env.OPEN_PHOTO_SUPABASE_BUCKET || OPEN_PHOTO_SUPABASE_BUCKET).trim()
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.B2_MEDIA_VALIDATION_CONCURRENCY || 16)))
const DELIVERY_BASE = String(process.env.B2_MEDIA_DELIVERY_BASE_URL || 'https://puddle.you/api/open-photo').replace(/\/+$/, '')
const B2_KEY_ID = String(process.env.B2_MEDIA_APPLICATION_KEY_ID || process.env.B2_MEDIA_KEY_ID || process.env.B2_KEY_ID || '').trim()
const B2_APPLICATION_KEY = String(process.env.B2_MEDIA_APPLICATION_KEY || process.env.B2_APPLICATION_KEY || '').trim()
const B2_BUCKET_ID = String(process.env.B2_MEDIA_BUCKET_ID || '').trim()
const B2_BUCKET_NAME = String(process.env.B2_MEDIA_BUCKET_NAME || process.env.B2_BUCKET || '').trim()
const RETRYABLE_HTTP = new Set([401, 408, 425, 429, 500, 502, 503, 504])

for (const [name, value] of Object.entries({ B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME })) {
  if (!value) throw new Error(`${name} is required for guarded cleanup validation.`)
}

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function encodeB2Key(key) {
  return String(key || '').split('/').map((part) => encodeURIComponent(part)).join('/')
}

function canonicalOpenPhotoKey(media) {
  const hash = String(media.content_hash || '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(hash) && media.storage_key === `media/photos/by-sha256/${hash.slice(0, 2)}/${hash}.jpg`
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
  return loadPaged((from, to) => admin.from('location_photo_b2_migration_audit')
    .select('photo_source_id,legacy_storage_key,legacy_remote_url,legacy_content_hash,legacy_byte_size,captured_at')
    .order('photo_source_id', { ascending: true }).range(from, to))
}

async function loadApprovedPhotos(admin) {
  return loadPaged((from, to) => admin.from('location_photo_sources')
    .select('id,storage_backend,media_object_id,remote_url,status')
    .eq('status', 'approved').order('id', { ascending: true }).range(from, to))
}

async function loadB2MediaObjects(admin) {
  return loadPaged((from, to) => admin.from('media_objects')
    .select('id,storage_backend,storage_key,public_url,content_hash,byte_size')
    .eq('storage_backend', 'b2').order('id', { ascending: true }).range(from, to))
}

async function retry(label, operation) {
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation(attempt)
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

let b2Auth = null
let b2AuthRefresh = null
async function refreshB2Auth() {
  if (!b2AuthRefresh) {
    b2AuthRefresh = authorizeB2({ keyId: B2_KEY_ID, applicationKey: B2_APPLICATION_KEY })
      .then((auth) => {
        const capabilities = new Set(auth.allowed?.capabilities || [])
        const buckets = Array.isArray(auth.allowed?.buckets) ? auth.allowed.buckets : []
        if (capabilities.size && !capabilities.has('readFiles')) throw new Error('B2 media key lacks readFiles capability.')
        if (buckets.length && !buckets.some((bucket) => bucket?.name === B2_BUCKET_NAME && (!B2_BUCKET_ID || bucket?.id === B2_BUCKET_ID))) {
          throw new Error('B2 media key is not authorized for the configured bucket.')
        }
        if (!B2_BUCKET_ID && !buckets.some((bucket) => bucket?.name === B2_BUCKET_NAME && bucket?.id)) {
          throw new Error('B2 bucket ID is not configured and could not be derived from the restricted key.')
        }
        b2Auth = auth
        return auth
      })
      .finally(() => { b2AuthRefresh = null })
  }
  return b2AuthRefresh
}

async function fetchPrivateB2Body(media) {
  return retry(`Private B2 origin ${media.id}`, async () => {
    const auth = b2Auth || await refreshB2Auth()
    const response = await fetch(`${auth.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME)}/${encodeB2Key(media.storage_key)}`, {
      headers: { Authorization: auth.authorizationToken, Accept: 'image/jpeg' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) {
      if (response.status === 401) {
        b2Auth = null
        await refreshB2Auth()
      }
      const error = new Error(`private B2 origin returned HTTP ${response.status} for ${media.storage_key}`)
      error.status = response.status
      if (!RETRYABLE_HTTP.has(response.status)) error.nonRetryable = true
      throw error
    }
    return Buffer.from(await response.arrayBuffer())
  })
}

async function fetchProductionBody(media) {
  const url = `${DELIVERY_BASE}/${String(media.content_hash).toLowerCase()}`
  return retry(`Production delivery ${media.id}`, async () => {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      const error = new Error(`production delivery returned HTTP ${response.status} for ${media.content_hash}`)
      error.status = response.status
      throw error
    }
    if (!String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/jpeg')) {
      throw new Error(`production delivery returned unexpected content type ${response.headers.get('content-type')}`)
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
      const index = cursor++
      if (index >= items.length) return
      try { await worker(items[index], index) }
      catch (error) { failures.push({ item: items[index], error: error.message }) }
    }
  }))
  return failures
}

const admin = createAdminClient()
const storage = admin.storage.from(BUCKET)
const [auditRows, photos, mediaObjects] = await Promise.all([loadAudit(admin), loadApprovedPhotos(admin), loadB2MediaObjects(admin)])
const photosById = new Map(photos.map((row) => [row.id, row]))
const mediaById = new Map(mediaObjects.map((row) => [row.id, row]))
const auditByPhotoId = new Map(auditRows.map((row) => [row.photo_source_id, row]))
const failures = []
const referencedMedia = new Map()
const knownLegacyByKey = new Map()
const unknownLegacyRows = []

for (const audit of auditRows) {
  const photo = photosById.get(audit.photo_source_id)
  if (!photo) { failures.push(`Audit photo ${audit.photo_source_id} is missing.`); continue }
  if (photo.storage_backend !== 'b2' || !photo.media_object_id) { failures.push(`Photo ${photo.id} is not attached to B2.`); continue }
  const media = mediaById.get(photo.media_object_id)
  if (!media) { failures.push(`Photo ${photo.id} references missing media object ${photo.media_object_id}.`); continue }
  if (!canonicalOpenPhotoKey(media)) { failures.push(`Media object ${media.id} does not use the canonical content-addressed open-photo key.`); continue }
  if (!Number.isFinite(Number(media.byte_size)) || Number(media.byte_size) <= 0) { failures.push(`Media object ${media.id} has invalid byte size.`); continue }
  if (photo.remote_url !== media.public_url) failures.push(`Photo ${photo.id} URL differs from media object ${media.id}.`)
  if (audit.legacy_content_hash && String(audit.legacy_content_hash).toLowerCase() !== String(media.content_hash).toLowerCase()) failures.push(`Photo ${photo.id} audit SHA256 mismatch.`)
  if (audit.legacy_byte_size != null && Number(audit.legacy_byte_size) !== Number(media.byte_size)) failures.push(`Photo ${photo.id} audit byte-size mismatch.`)
  referencedMedia.set(media.id, media)
  if (audit.legacy_content_hash && audit.legacy_byte_size != null) {
    const value = { hash: String(audit.legacy_content_hash).toLowerCase(), bytes: Number(audit.legacy_byte_size) }
    const expected = knownLegacyByKey.get(audit.legacy_storage_key)
    if (expected && (expected.hash !== value.hash || expected.bytes !== value.bytes)) failures.push(`Legacy key ${audit.legacy_storage_key} has conflicting audit metadata.`)
    else knownLegacyByKey.set(audit.legacy_storage_key, value)
  } else unknownLegacyRows.push({ audit, media })
}

for (const photo of photos) {
  if (!auditByPhotoId.has(photo.id) && photo.storage_backend === 'supabase') failures.push(`Approved Supabase-backed photo ${photo.id} is not represented in the migration audit.`)
}
if (auditRows.length !== 15461 || referencedMedia.size !== 13913) failures.push(`Unexpected migration cardinality: audit=${auditRows.length}, referencedMedia=${referencedMedia.size}.`)
if (failures.length) {
  console.error(JSON.stringify({ phase: 'database_relationships', failureCount: failures.length, failures: failures.slice(0, 50) }, null, 2))
  process.exit(1)
}

await refreshB2Auth()
const uniqueMedia = [...referencedMedia.values()]
let verifiedObjects = 0
let verifiedBytes = 0
const deliveryFailures = await runWorkers(uniqueMedia, async (media) => {
  const [originBody, publicBody] = await Promise.all([fetchPrivateB2Body(media), fetchProductionBody(media)])
  const expectedBytes = Number(media.byte_size)
  const expectedHash = String(media.content_hash).toLowerCase()
  for (const [label, body] of [['private B2 origin', originBody], ['production delivery', publicBody]]) {
    if (body.length !== expectedBytes) throw new Error(`${label} byte-size mismatch: db=${expectedBytes}, actual=${body.length}`)
    const actualHash = sha256(body)
    if (actualHash !== expectedHash) throw new Error(`${label} SHA256 mismatch: db=${expectedHash}, actual=${actualHash}`)
  }
  if (!originBody.equals(publicBody)) throw new Error('private B2 origin and production delivery bytes differ')
  verifiedObjects += 1
  verifiedBytes += expectedBytes
  if (verifiedObjects % 500 === 0 || verifiedObjects === uniqueMedia.length) console.log(`verified private B2 + production delivery ${verifiedObjects}/${uniqueMedia.length}`)
})
if (deliveryFailures.length) {
  console.error(JSON.stringify({ phase: 'b2_and_production_delivery', failureCount: deliveryFailures.length, failures: deliveryFailures.slice(0, 20).map(({ item, error }) => ({ mediaObjectId: item.id, key: item.storage_key, error })) }, null, 2))
  process.exit(1)
}

const legacyTargets = []
for (const { audit, media } of unknownLegacyRows) {
  const known = knownLegacyByKey.get(audit.legacy_storage_key)
  if (known) {
    if (known.hash !== String(media.content_hash).toLowerCase() || known.bytes !== Number(media.byte_size)) failures.push(`Legacy key ${audit.legacy_storage_key} known metadata conflicts with media ${media.id}.`)
  } else legacyTargets.push({ audit, media })
}
const uniqueUnknownLegacy = [...new Map(legacyTargets.map((entry) => [entry.audit.legacy_storage_key, entry])).values()]
const legacyFailures = await runWorkers(uniqueUnknownLegacy, async ({ audit, media }) => {
  const body = await downloadLegacy(storage, audit.legacy_storage_key)
  if (body.length !== Number(media.byte_size)) throw new Error(`byte-size mismatch: B2=${media.byte_size}, Supabase=${body.length}`)
  const actualHash = sha256(body)
  if (actualHash !== String(media.content_hash).toLowerCase()) throw new Error(`SHA256 mismatch: B2=${media.content_hash}, Supabase=${actualHash}`)
})
if (failures.length || legacyFailures.length) {
  console.error(JSON.stringify({ phase: 'legacy_source_verification', failureCount: failures.length + legacyFailures.length, failures: [...failures.slice(0, 20).map((error) => ({ error })), ...legacyFailures.slice(0, 20).map(({ item, error }) => ({ legacyStorageKey: item.audit.legacy_storage_key, error }))] }, null, 2))
  process.exit(1)
}

const uniqueLegacyKeys = [...new Set(auditRows.map((row) => row.legacy_storage_key))]
if (uniqueLegacyKeys.length !== 13921) throw new Error(`Unexpected legacy key count ${uniqueLegacyKeys.length}; expected 13921.`)
const summary = {
  auditRows: auditRows.length,
  approvedPhotos: photos.length,
  referencedB2Objects: uniqueMedia.length,
  verifiedB2Objects: verifiedObjects,
  verifiedB2Bytes: verifiedBytes,
  verifiedProductionObjects: verifiedObjects,
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
