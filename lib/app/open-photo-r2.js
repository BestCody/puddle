import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { putR2Object, r2Configuration, r2PublicUrl } from './r2-s3.js'

export function openPhotoR2Limits(env = process.env) {
  const targetBytes = Math.max(15_000, Math.min(120_000, Number(env.OPEN_PHOTO_TARGET_BYTES || 45_000)))
  const hardMaxBytes = Math.max(targetBytes, Math.min(180_000, Number(env.OPEN_PHOTO_HARD_MAX_BYTES || 60_000)))
  return { targetBytes, hardMaxBytes }
}

export async function openPhotoDifferenceHash(body) {
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

export async function transformOpenPhotoForR2(source, limits = openPhotoR2Limits()) {
  const attempts = [
    { width: 720, quality: 44 },
    { width: 680, quality: 39 },
    { width: 640, quality: 35 },
    { width: 580, quality: 31 },
    { width: 540, quality: 27 }
  ]
  let best = null
  for (const attempt of attempts) {
    const result = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: attempt.width, height: Math.round(attempt.width * 0.625), fit: 'cover', position: 'attention', withoutEnlargement: true })
      .avif({ quality: attempt.quality, effort: 6, chromaSubsampling: '4:2:0' })
      .toBuffer({ resolveWithObject: true })
    const candidate = { body: result.data, width: result.info.width, height: result.info.height }
    if (!best || candidate.body.length < best.body.length) best = candidate
    if (candidate.body.length <= limits.targetBytes) {
      best = candidate
      break
    }
  }
  if (!best?.body?.length || best.body.length > limits.hardMaxBytes) {
    throw new Error(`Compressed AVIF exceeds ${limits.hardMaxBytes} bytes.`)
  }
  const contentHash = createHash('sha256').update(best.body).digest('hex')
  return {
    ...best,
    contentHash,
    perceptualHash: await openPhotoDifferenceHash(best.body),
    byteSize: best.body.length
  }
}

async function exactDuplicate(admin, hash) {
  const result = await admin
    .from('media_objects')
    .select('id,public_url,storage_key,content_hash,perceptual_hash,byte_size,width,height')
    .eq('content_hash', hash)
    .limit(1)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  return result.data || null
}

export async function storeOpenPhotoInR2(admin, source, {
  config = r2Configuration(),
  limits = openPhotoR2Limits()
} = {}) {
  if (!admin) throw new Error('An administrative Supabase client is required.')
  if (!config?.publicBaseUrl) throw new Error('R2 credentials and R2_PUBLIC_BASE_URL are required.')
  const transformed = await transformOpenPhotoForR2(source, limits)
  const duplicate = await exactDuplicate(admin, transformed.contentHash)
  const key = duplicate?.storage_key || `photos/open/${transformed.contentHash.slice(0, 2)}/${transformed.contentHash}.avif`
  const remoteUrl = duplicate?.public_url || r2PublicUrl(key, config)
  if (!remoteUrl) throw new Error('R2 public URL is unavailable.')

  if (!duplicate) {
    await putR2Object(key, transformed.body, {
      contentType: 'image/avif',
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { sha256: transformed.contentHash, dhash: transformed.perceptualHash },
      config
    })
  }

  let media = duplicate
  if (!media) {
    const result = await admin.from('media_objects').upsert({
      storage_backend: 'r2',
      storage_key: key,
      public_url: remoteUrl,
      content_hash: transformed.contentHash,
      perceptual_hash: transformed.perceptualHash,
      byte_size: transformed.byteSize,
      width: transformed.width,
      height: transformed.height
    }, { onConflict: 'content_hash' }).select('id,public_url,storage_key,content_hash,perceptual_hash,byte_size,width,height').single()
    if (result.error) throw result.error
    media = result.data
  }

  if (!media?.id) throw new Error('Could not register the R2 media object.')
  return {
    mediaObjectId: media.id,
    remoteUrl: media.public_url || remoteUrl,
    storageBackend: 'r2',
    storageKey: media.storage_key || key,
    contentHash: media.content_hash || transformed.contentHash,
    perceptualHash: media.perceptual_hash || transformed.perceptualHash,
    byteSize: Number(media.byte_size || transformed.byteSize),
    width: Number(media.width || transformed.width),
    height: Number(media.height || transformed.height),
    reused: Boolean(duplicate)
  }
}
