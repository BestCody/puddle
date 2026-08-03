import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createAdminClient } from '../lib/supabase/admin.js'
import { putR2Object, r2Configuration, r2PublicUrl } from '../lib/app/r2-s3.js'

const APPLY = process.argv.includes('--apply')
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.OPEN_PHOTO_R2_MIGRATION_LIMIT || 200)))
const TARGET_BYTES = Math.max(15_000, Math.min(120_000, Number(process.env.OPEN_PHOTO_TARGET_BYTES || 45_000)))
const HARD_MAX_BYTES = Math.max(TARGET_BYTES, Math.min(180_000, Number(process.env.OPEN_PHOTO_HARD_MAX_BYTES || 60_000)))
const MAX_SOURCE_BYTES = 10_000_000
const config = r2Configuration()
if (APPLY && (!config || !config.publicBaseUrl)) throw new Error('R2 credentials and R2_PUBLIC_BASE_URL are required with --apply.')

function supabaseProjectHost() {
  try {
    const url = new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''))
    return url.protocol === 'https:' ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

function supabaseStorageKey(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== supabaseProjectHost()) return null
    const prefix = '/storage/v1/object/public/puddle-public-media/'
    if (!url.pathname.startsWith(prefix)) return null
    return decodeURIComponent(url.pathname.slice(prefix.length))
  } catch {
    return null
  }
}

async function downloadSource(value) {
  const key = supabaseStorageKey(value)
  if (!key) throw new Error('Open photo is not in the Puddle Supabase public-media bucket.')
  const response = await fetch(value, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`Supabase photo download returned ${response.status}.`)
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) throw new Error(`Unsupported photo type ${type || 'unknown'}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_SOURCE_BYTES) throw new Error('Open photo exceeds 10 MB.')
  const body = Buffer.from(await response.arrayBuffer())
  if (!body.length || body.length > MAX_SOURCE_BYTES) throw new Error('Open photo is empty or exceeds 10 MB.')
  return { body, key }
}

async function differenceHash(body) {
  const raw = await sharp(body).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = 0n
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = raw[row * 9 + column]
      const right = raw[row * 9 + column + 1]
      bits = (bits << 1n) | BigInt(left > right ? 1 : 0)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

async function transformImage(source) {
  const attempts = [
    { width: 720, quality: 45 },
    { width: 720, quality: 40 },
    { width: 640, quality: 38 },
    { width: 640, quality: 34 },
    { width: 560, quality: 32 },
    { width: 560, quality: 28 }
  ]
  let best = null
  for (const attempt of attempts) {
    const result = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: attempt.width, height: Math.round(attempt.width * 0.625), fit: 'cover', position: 'attention', withoutEnlargement: true })
      .avif({ quality: attempt.quality, effort: 8, chromaSubsampling: '4:2:0' })
      .toBuffer({ resolveWithObject: true })
    const candidate = { body: result.data, width: result.info.width, height: result.info.height }
    if (!best || candidate.body.length < best.body.length) best = candidate
    if (candidate.body.length <= TARGET_BYTES) {
      best = candidate
      break
    }
  }
  if (!best?.body?.length || best.body.length > HARD_MAX_BYTES) throw new Error(`Compressed AVIF exceeds ${HARD_MAX_BYTES} bytes.`)
  return {
    ...best,
    contentHash: createHash('sha256').update(best.body).digest('hex'),
    perceptualHash: await differenceHash(best.body),
    byteSize: best.body.length
  }
}

async function exactDuplicate(admin, hash) {
  const result = await admin
    .from('location_photo_sources')
    .select('remote_url,storage_key,storage_backend,content_hash,perceptual_hash,byte_size,width,height')
    .eq('status', 'approved')
    .eq('storage_backend', 'r2')
    .eq('content_hash', hash)
    .limit(1)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  return result.data || null
}

const admin = createAdminClient()
const rows = await admin
  .from('location_photo_sources')
  .select('id,remote_url,source,provider,status,storage_backend,verified_at')
  .eq('source', 'licensed_public')
  .eq('status', 'approved')
  .neq('storage_backend', 'r2')
  .order('verified_at', { ascending: false })
  .limit(LIMIT * 4)
if (rows.error) throw rows.error

const candidates = (rows.data || []).filter((row) => supabaseStorageKey(row.remote_url)).slice(0, LIMIT)
let migrated = 0
let reused = 0
let failed = 0
let bytes = 0
for (const row of candidates) {
  try {
    const source = await downloadSource(row.remote_url)
    const transformed = await transformImage(source.body)
    const duplicate = await exactDuplicate(admin, transformed.contentHash)
    const key = duplicate?.storage_key || `photos/open/${transformed.contentHash.slice(0, 2)}/${transformed.contentHash}.avif`
    const remoteUrl = duplicate?.remote_url || r2PublicUrl(key, config)
    console.log(`${APPLY ? 'Migrating' : 'Would migrate'} ${row.id} to ${key} (${transformed.byteSize} bytes).`)
    if (!APPLY) continue
    if (!remoteUrl) throw new Error('R2 public URL is unavailable.')
    if (!duplicate) {
      await putR2Object(key, transformed.body, {
        contentType: 'image/avif',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { sha256: transformed.contentHash, dhash: transformed.perceptualHash },
        config
      })
    } else {
      reused += 1
    }
    const update = await admin.from('location_photo_sources').update({
      remote_url: remoteUrl,
      storage_backend: 'r2',
      storage_key: key,
      content_hash: transformed.contentHash,
      perceptual_hash: transformed.perceptualHash,
      byte_size: transformed.byteSize,
      width: transformed.width,
      height: transformed.height,
      cache_ttl_seconds: 86_400
    }).eq('id', row.id)
    if (update.error) throw update.error
    const removal = await admin.storage.from('puddle-public-media').remove([source.key])
    if (removal.error) console.warn(`${row.id}: migrated, but Supabase staging cleanup failed: ${removal.error.message}`)
    migrated += 1
    bytes += transformed.byteSize
  } catch (error) {
    failed += 1
    console.warn(`${row.id}: ${error.message}`)
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run', inspected: candidates.length, migrated, reused, failed,
  bytes, targetBytes: TARGET_BYTES, hardMaxBytes: HARD_MAX_BYTES
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the migration plan.')
