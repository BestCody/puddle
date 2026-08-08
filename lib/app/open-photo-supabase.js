import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const OPEN_PHOTO_SUPABASE_BUCKET = 'puddle-public-media'

const bucketChecks = new WeakMap()

function bucketCheck(admin, bucket) {
  let checks = bucketChecks.get(admin)
  if (!checks) {
    checks = new Map()
    bucketChecks.set(admin, checks)
  }
  if (!checks.has(bucket)) {
    checks.set(bucket, (async () => {
      const result = await admin.storage.getBucket(bucket)
      if (result.error) throw result.error
      if (!result.data || result.data.public !== true) {
        throw new Error(`${bucket} must exist and be public before card delivery can use it.`)
      }
      return true
    })())
  }
  return checks.get(bucket)
}

export async function openPhotoSupabaseDifferenceHash(body) {
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

export async function transformOpenPhotoForSupabase(source) {
  if (!source?.length) throw new Error('Open-photo source is empty.')
  const result = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 1600,
      height: 1000,
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: true
    })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  if (!result.data?.length || !result.info?.width || !result.info?.height) {
    throw new Error('Normalized open photo is invalid.')
  }
  const contentHash = createHash('sha256').update(result.data).digest('hex')
  return {
    body: result.data,
    width: result.info.width,
    height: result.info.height,
    contentHash,
    perceptualHash: await openPhotoSupabaseDifferenceHash(result.data),
    byteSize: result.data.length
  }
}

export async function storeOpenPhotoInSupabase(admin, source, {
  bucket = OPEN_PHOTO_SUPABASE_BUCKET
} = {}) {
  if (!admin?.storage) throw new Error('An administrative Supabase client is required.')
  const safeBucket = String(bucket || '').trim()
  if (!safeBucket) throw new Error('Supabase open-photo bucket is required.')

  await bucketCheck(admin, safeBucket)
  const transformed = await transformOpenPhotoForSupabase(source)
  const key = `open-photos/by-hash/${transformed.contentHash.slice(0, 2)}/${transformed.contentHash}.jpg`
  const storage = admin.storage.from(safeBucket)
  const upload = await storage.upload(key, transformed.body, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true
  })
  if (upload.error) throw upload.error

  const remoteUrl = storage.getPublicUrl(key).data.publicUrl
  if (!/^https:\/\//i.test(String(remoteUrl || ''))) {
    throw new Error('Supabase did not return a public HTTPS photo URL.')
  }

  return {
    mediaObjectId: null,
    remoteUrl,
    storageBackend: 'supabase',
    storageKey: key,
    contentHash: transformed.contentHash,
    perceptualHash: transformed.perceptualHash,
    byteSize: transformed.byteSize,
    width: transformed.width,
    height: transformed.height,
    reused: false
  }
}
