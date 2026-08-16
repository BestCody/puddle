import { createB2BucketClientFromEnv, joinB2Key } from '../storage/b2-native.js'
import { transformOpenPhoto } from './open-photo-transform.js'

let mediaClientPromise = null

function mediaClient() {
  if (!mediaClientPromise) mediaClientPromise = createB2BucketClientFromEnv('B2_MEDIA')
  return mediaClientPromise
}

export function openPhotoB2Key(contentHash, prefix = process.env.B2_MEDIA_OPEN_PHOTO_PREFIX || 'photos/by-sha256') {
  const hash = String(contentHash || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Open-photo SHA256 is invalid.')
  return joinB2Key(prefix, hash.slice(0, 2), `${hash}.jpg`)
}

export async function storeOpenPhotoInB2(_admin, source, { client = null } = {}) {
  const transformed = await transformOpenPhoto(source)
  const b2 = client || await mediaClient()
  const key = openPhotoB2Key(transformed.contentHash)
  const uploader = b2.uploader()
  const uploaded = await uploader.uploadBuffer(key, transformed.body, {
    contentType: 'image/jpeg',
    metadata: { sha256: transformed.contentHash, purpose: 'puddle_open_location_photo' }
  })

  return {
    mediaObjectId: null,
    remoteUrl: uploaded.publicUrl,
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
