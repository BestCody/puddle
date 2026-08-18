import { createB2BucketClientFromEnv, joinB2Key } from '../storage/b2-native.js'
import { transformOpenPhoto } from './open-photo-transform.js'

let mediaClientPromise = null

function mediaClient() {
  if (!mediaClientPromise) mediaClientPromise = createB2BucketClientFromEnv('B2_MEDIA')
  return mediaClientPromise
}

export function openPhotoB2Key(contentHash, prefix = process.env.B2_MEDIA_OPEN_PHOTO_PREFIX || 'media/photos/by-sha256') {
  const hash = String(contentHash || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Open-photo SHA256 is invalid.')
  return joinB2Key(prefix, hash.slice(0, 2), `${hash}.jpg`)
}

export async function storeOpenPhotoInB2(admin, source, { client = null } = {}) {
  const transformed = await transformOpenPhoto(source)
  const b2 = client || await mediaClient()
  const key = openPhotoB2Key(transformed.contentHash)
  const uploader = b2.uploader()
  const uploaded = await uploader.uploadBuffer(key, transformed.body, {
    contentType: 'image/jpeg',
    metadata: { sha256: transformed.contentHash, purpose: 'puddle_open_location_photo' }
  })

  if (Number.isFinite(Number(uploaded.contentLength)) && Number(uploaded.contentLength) !== transformed.byteSize) {
    throw new Error('B2 media upload byte count did not match the normalized image.')
  }
  if (uploaded.fileInfo?.sha256 && String(uploaded.fileInfo.sha256).toLowerCase() !== transformed.contentHash) {
    throw new Error('B2 media upload SHA256 metadata did not match the normalized image.')
  }

  if (!admin?.from) throw new Error('Supabase admin client is required to register B2 media.')
  const now = new Date().toISOString()
  const { data: mediaObject, error: mediaError } = await admin
    .from('media_objects')
    .upsert({
      storage_backend: 'b2',
      storage_key: key,
      public_url: null,
      content_hash: transformed.contentHash,
      perceptual_hash: transformed.perceptualHash,
      byte_size: transformed.byteSize,
      width: transformed.width,
      height: transformed.height,
      updated_at: now
    }, { onConflict: 'content_hash' })
    .select('id,storage_backend,storage_key,content_hash,byte_size')
    .single()
  if (mediaError) throw mediaError
  if (!mediaObject?.id || mediaObject.storage_backend !== 'b2' || mediaObject.storage_key !== key ||
      String(mediaObject.content_hash || '').toLowerCase() !== transformed.contentHash ||
      Number(mediaObject.byte_size) !== transformed.byteSize) {
    throw new Error('Canonical B2 media registration did not match the uploaded bytes.')
  }

  return {
    mediaObjectId: mediaObject.id,
    remoteUrl: null,
    storageBackend: 'b2',
    storageKey: key,
    contentHash: transformed.contentHash,
    perceptualHash: transformed.perceptualHash,
    byteSize: transformed.byteSize,
    width: transformed.width,
    height: transformed.height,
    reused: false
  }
}
