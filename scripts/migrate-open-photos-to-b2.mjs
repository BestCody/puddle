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
  const result = await storage.download(row.storage_key)
  if (result.error) throw result.error
  const body = Buffer.from(await result.data.arrayBuffer())
  if (!body.length) throw new Error('Legacy Supabase object is empty.')
  const hash = sha256(body)
  if (row.content_hash && String(row.content_hash).toLowerCase() !== hash) {
    throw new Error(`SHA256 mismatch for ${row.storage_key}.`)
  }
  return { body, hash }
}

async function migrateRow(admin, storage, uploader, b2, row) {
  const { body, hash } = await downloadLegacy(storage, row)
  const key = openPhotoB2Key(hash)
  if (!APPLY) return { id: row.id, status: 'would_migrate', key, bytes: body.length }

  const uploaded = await uploader.uploadBuffer(key, body, {
    contentType: 'image/jpeg',
    metadata: { sha256: hash, migrated_from: 'supabase_open_photos' }
  })

  const update = await admin
    .from('location_photo_sources')
    .update({
      storage_backend: 'b2',
      storage_key: key,
      remote_url: uploaded.publicUrl,
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

  if (DELETE_SOURCE) {
    const removed = await storage.remove([row.storage_key])
    if (removed.error) throw new Error(`B2 migration succeeded but Supabase cleanup failed: ${removed.error.message}`)
  }
  return { id: row.id, status: DELETE_SOURCE ? 'migrated_and_deleted_source' : 'migrated', key, bytes: body.length }
}

const admin = createAdminClient()
const storage = admin.storage.from(BUCKET)
const b2 = await createB2BucketClientFromEnv('B2_MEDIA')
const rows = await loadRows(admin)
const summary = { mode: APPLY ? 'apply' : 'dry-run', deleteSource: DELETE_SOURCE, inspected: rows.length, migrated: 0, failed: 0, bytes: 0, failures: [] }
let cursor = 0

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, rows.length)) }, async () => {
  const uploader = b2.uploader()
  while (true) {
    const index = cursor
    cursor += 1
    if (index >= rows.length) return
    const row = rows[index]
    try {
      const result = await migrateRow(admin, storage, uploader, b2, row)
      summary.migrated += 1
      summary.bytes += Number(result.bytes || 0)
      console.log(`${result.status}: ${row.id} -> ${result.key}`)
    } catch (error) {
      summary.failed += 1
      if (summary.failures.length < 20) summary.failures.push({ id: row.id, error: error.message })
      console.warn(`migration failed for ${row.id}: ${error.message}`)
    }
  }
}))

console.log(JSON.stringify(summary, null, 2))
if (summary.failed) process.exitCode = 1
