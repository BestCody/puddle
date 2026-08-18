import { createHash } from 'node:crypto'
import { createAdminClient } from '../lib/supabase/admin.js'
import { OPEN_PHOTO_SUPABASE_BUCKET } from '../lib/app/open-photo-supabase.js'
import { openPhotoB2Key } from '../lib/app/open-photo-b2.js'
import { createB2BucketClientFromEnv } from '../lib/storage/b2-native.js'

const APPLY = process.argv.includes('--apply')
const DELETE_SOURCE = process.argv.includes('--delete-source')
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(100_000, Number(limitArgument || process.env.B2_MEDIA_MIGRATION_LIMIT || 100_000)))
const CONCURRENCY = Math.max(1, Math.min(64, Number(process.env.B2_MEDIA_MIGRATION_CONCURRENCY || 16)))
const BUCKET = String(process.env.OPEN_PHOTO_SUPABASE_BUCKET || OPEN_PHOTO_SUPABASE_BUCKET).trim()

if (DELETE_SOURCE && !APPLY) throw new Error('--delete-source requires --apply.')

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isTransientDownloadError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true
  const message = String(error?.message || error || '').toLowerCase()
  return /bad gateway|gateway timeout|fetch failed|network|timeout|temporar/.test(message)
}

async function loadRows(admin) {
  const rows = []
  const pageSize = 1000
  for (let offset = 0; offset < LIMIT; offset += pageSize) {
    const result = await admin
      .from('location_photo_sources')
      .select('id,location_id,provider,storage_backend,storage_key,remote_url,content_hash,byte_size,status')
      .eq('storage_backend', 'supabase')
      .eq('status', 'approved')
      .not('storage_key', 'is', null)
      .order('id', { ascending: true })
      .range(offset, Math.min(LIMIT, offset + pageSize) - 1)
    if (result.error) throw result.error
    const batch = result.data || []
    rows.push(...batch)
    if (batch.length < pageSize || rows.length >= LIMIT) break
  }
  return rows.slice(0, LIMIT)
}

async function downloadLegacy(storage, row) {
  let lastError = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await storage.download(row.storage_key)
      if (result.error) throw result.error
      const body = Buffer.from(await result.data.arrayBuffer())
      if (!body.length) throw new Error('Legacy Supabase object is empty.')
      const hash = sha256(body)
      if (row.content_hash && String(row.content_hash).toLowerCase() !== hash) {
        throw new Error(`SHA256 mismatch for ${row.storage_key}.`)
      }
      if (row.byte_size && Number(row.byte_size) !== body.length) {
        throw new Error(`Byte-size mismatch for ${row.storage_key}: metadata=${row.byte_size}, downloaded=${body.length}.`)
      }
      return { body, hash }
    } catch (error) {
      lastError = error
      if (!isTransientDownloadError(error) || attempt === 4) throw error
      const delay = Math.min(8_000, 500 * (2 ** attempt))
      console.warn(`transient Supabase download failure for ${row.id}; retrying in ${delay}ms: ${error.message}`)
      await sleep(delay)
    }
  }
  throw lastError
}

function verifyRegisteredMediaObject(actual, expected) {
  if (!actual) throw new Error(`B2 media object ${expected.hash} is not registered.`)
  if (actual.storage_backend !== 'b2') throw new Error(`Registered media object ${actual.id} is not B2-backed.`)
  if (String(actual.content_hash || '').toLowerCase() !== expected.hash) throw new Error(`Registered media object ${actual.id} SHA256 verification failed.`)
  if (Number(actual.byte_size) !== expected.bytes) throw new Error(`Registered media object ${actual.id} byte-size verification failed.`)
  if (!actual.storage_key) throw new Error(`Registered media object ${actual.id} is missing its B2 storage key.`)
  if (!actual.public_url) throw new Error(`Registered media object ${actual.id} is missing its B2 delivery URL.`)
  return actual
}

async function readMediaObjectByHash(admin, hash) {
  const result = await admin
    .from('media_objects')
    .select('id,storage_backend,storage_key,public_url,content_hash,byte_size')
    .eq('content_hash', hash)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data || null
}

async function registerB2MediaObject(admin, expected) {
  const existing = await readMediaObjectByHash(admin, expected.hash)
  if (existing) return verifyRegisteredMediaObject(existing, expected)

  const inserted = await admin
    .from('media_objects')
    .insert({
      storage_backend: 'b2',
      storage_key: expected.key,
      public_url: expected.publicUrl,
      content_hash: expected.hash,
      byte_size: expected.bytes,
      updated_at: new Date().toISOString()
    })
    .select('id,storage_backend,storage_key,public_url,content_hash,byte_size')
    .maybeSingle()

  if (!inserted.error && inserted.data) return verifyRegisteredMediaObject(inserted.data, expected)

  // Multiple photo rows can reference identical bytes. Concurrent workers may race
  // to register the same unique content hash/storage key; the winning row is canonical.
  if (inserted.error?.code === '23505') {
    const raced = await readMediaObjectByHash(admin, expected.hash)
    return verifyRegisteredMediaObject(raced, expected)
  }
  if (inserted.error) throw inserted.error
  throw new Error(`B2 media object ${expected.hash} could not be registered.`)
}

async function verifyUpdatedRow(admin, rowId, expected) {
  const result = await admin
    .from('location_photo_sources')
    .select('id,storage_backend,storage_key,remote_url,content_hash,byte_size,media_object_id')
    .eq('id', rowId)
    .maybeSingle()
  if (result.error) throw result.error
  const actual = result.data
  if (!actual) throw new Error(`Migrated photo row ${rowId} could not be re-read for verification.`)
  if (actual.storage_backend !== 'b2') throw new Error(`Migrated photo row ${rowId} did not persist storage_backend=b2.`)
  if (actual.media_object_id !== expected.mediaObject.id) throw new Error(`Migrated photo row ${rowId} media_object_id verification failed.`)
  if (actual.storage_key !== null || actual.content_hash !== null || actual.byte_size !== null) {
    throw new Error(`Migrated photo row ${rowId} was not normalized onto media_objects.`)
  }
  if (actual.remote_url !== expected.mediaObject.public_url) throw new Error(`Migrated photo row ${rowId} delivery URL verification failed.`)

  const registered = await readMediaObjectByHash(admin, expected.hash)
  verifyRegisteredMediaObject(registered, { hash: expected.hash, bytes: expected.bytes })
  if (registered.id !== expected.mediaObject.id) throw new Error(`Migrated photo row ${rowId} resolved to the wrong media object.`)
  return actual
}

async function migrateRow(admin, storage, uploader, row) {
  const { body, hash } = await downloadLegacy(storage, row)
  const key = openPhotoB2Key(hash)
  if (!APPLY) return { id: row.id, status: 'would_migrate', key, bytes: body.length, hash, verified: true }

  const uploaded = await uploader.uploadBuffer(key, body, {
    contentType: 'image/jpeg',
    metadata: { sha256: hash, migrated_from: 'supabase_open_photos' }
  })
  if (Number.isFinite(Number(uploaded.contentLength)) && Number(uploaded.contentLength) !== body.length) {
    throw new Error(`B2 byte-size verification failed for ${row.id}.`)
  }
  if (uploaded.fileInfo?.sha256 && String(uploaded.fileInfo.sha256).toLowerCase() !== hash) {
    throw new Error(`B2 SHA256 metadata verification failed for ${row.id}.`)
  }

  const mediaObject = await registerB2MediaObject(admin, {
    key,
    publicUrl: uploaded.publicUrl,
    hash,
    bytes: body.length
  })

  const update = await admin
    .from('location_photo_sources')
    .update({
      storage_backend: 'b2',
      storage_key: mediaObject.storage_key,
      remote_url: mediaObject.public_url,
      content_hash: hash,
      byte_size: body.length,
      updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .eq('storage_backend', 'supabase')
    .select('id')
    .maybeSingle()
  if (update.error) throw update.error
  if (!update.data) throw new Error('Photo row changed while it was being migrated; B2 copy was left intact for idempotent retry.')

  await verifyUpdatedRow(admin, row.id, { mediaObject, hash, bytes: body.length })

  // Initial migrations never delete by default. Even when explicitly enabled by the
  // caller, cleanup occurs only after the B2 upload, registry, and DB relationship verify.
  if (DELETE_SOURCE) {
    const removed = await storage.remove([row.storage_key])
    if (removed.error) throw new Error(`B2 migration succeeded but Supabase cleanup failed: ${removed.error.message}`)
  }
  return {
    id: row.id,
    status: DELETE_SOURCE ? 'migrated_verified_and_deleted_source' : 'migrated_verified',
    key: mediaObject.storage_key,
    bytes: body.length,
    hash,
    mediaObjectId: mediaObject.id,
    verified: true
  }
}

const admin = createAdminClient()
const storage = admin.storage.from(BUCKET)
const rows = await loadRows(admin)
const b2 = APPLY ? await createB2BucketClientFromEnv('B2_MEDIA') : null
const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  deleteSource: DELETE_SOURCE,
  inspected: rows.length,
  migrated: 0,
  verified: 0,
  failed: 0,
  bytes: 0,
  failures: []
}
let cursor = 0

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, rows.length)) }, async () => {
  const uploader = b2?.uploader() || null
  while (true) {
    const index = cursor
    cursor += 1
    if (index >= rows.length) return
    const row = rows[index]
    try {
      const result = await migrateRow(admin, storage, uploader, row)
      summary.migrated += 1
      if (result.verified) summary.verified += 1
      summary.bytes += Number(result.bytes || 0)
      console.log(`${result.status}: ${row.id} -> ${result.key}${result.mediaObjectId ? ` (${result.mediaObjectId})` : ''}`)
    } catch (error) {
      summary.failed += 1
      if (summary.failures.length < 20) summary.failures.push({ id: row.id, error: error.message })
      console.warn(`migration failed for ${row.id}: ${error.message}`)
    }
  }
}))

console.log(JSON.stringify(summary, null, 2))
if (summary.failed) process.exitCode = 1
