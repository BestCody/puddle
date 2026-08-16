import { transformOpenPhoto, openPhotoDifferenceHash } from './open-photo-transform.js'

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
      if (!result.data || result.data.public !== true) throw new Error(`${bucket} must exist and be public before card delivery can use it.`)
      return true
    })())
  }
  return checks.get(bucket)
}

// Backward-compatible names for tests and migration scripts. Transformation is storage-neutral now.
export const openPhotoSupabaseDifferenceHash = openPhotoDifferenceHash
export const transformOpenPhotoForSupabase = transformOpenPhoto

export async function storeOpenPhotoInLegacySupabase(admin, source, { bucket = OPEN_PHOTO_SUPABASE_BUCKET } = {}) {
  if (!admin?.storage) throw new Error('An administrative Supabase client is required.')
  const safeBucket = String(bucket || '').trim()
  if (!safeBucket) throw new Error('Supabase open-photo bucket is required.')
  await bucketCheck(admin, safeBucket)
  const transformed = await transformOpenPhoto(source)
  const key = `open-photos/by-hash/${transformed.contentHash.slice(0, 2)}/${transformed.contentHash}.jpg`
  const storage = admin.storage.from(safeBucket)
  const upload = await storage.upload(key, transformed.body, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true })
  if (upload.error) throw upload.error
  const remoteUrl = storage.getPublicUrl(key).data.publicUrl
  if (!/^https:\/\//i.test(String(remoteUrl || ''))) throw new Error('Supabase did not return a public HTTPS photo URL.')
  return {
    mediaObjectId: null, remoteUrl, storageBackend: 'supabase', storageKey: key,
    contentHash: transformed.contentHash, perceptualHash: transformed.perceptualHash,
    byteSize: transformed.byteSize, width: transformed.width, height: transformed.height, reused: false
  }
}

// Existing callers keep working, but production writes are now B2-only.
export async function storeOpenPhotoInSupabase(admin, source, options = {}) {
  const { storeOpenPhotoInB2 } = await import('./open-photo-b2.js')
  return storeOpenPhotoInB2(admin, source, options)
}
