import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

export async function runStagingStorageSmoke(env = process.env) {
  const { auth } = validateStagingAuthSmokeEnv(env)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#efc850' } })
    .webp().toBuffer()
  const imageHash = createHash('sha256').update(image).digest('hex')
  const objectPath = `staging-smoke/${randomUUID()}.webp`
  const uploaded = []
  let failure
  try {
    for (const [bucket, isPublic] of [['puddle-public-media', true], ['puddle-private-media', false]]) {
      const storage = admin.storage.from(bucket)
      const upload = await storage.upload(objectPath, image, { contentType: 'image/webp', upsert: false })
      assert.equal(upload.error, null, `${bucket} must accept the disposable image`)
      uploaded.push(bucket)
      const download = await storage.download(objectPath)
      assert.equal(download.error, null, `${bucket} must return the uploaded image to an authorized client`)
      const deliveredHash = createHash('sha256').update(Buffer.from(await download.data.arrayBuffer())).digest('hex')
      assert.equal(deliveredHash, imageHash, `${bucket} must preserve image bytes`)
      const publicUrl = storage.getPublicUrl(objectPath).data.publicUrl
      const anonymous = await fetch(publicUrl, { signal: AbortSignal.timeout(15_000) })
      if (isPublic) {
        assert.equal(anonymous.status, 200, `${bucket} must serve the public image`)
        const publicHash = createHash('sha256').update(Buffer.from(await anonymous.arrayBuffer())).digest('hex')
        assert.equal(publicHash, imageHash, `${bucket} must preserve public image bytes`)
      } else {
        assert.notEqual(anonymous.status, 200, `${bucket} must not serve anonymously`)
      }
      process.stdout.write(`${bucket}: upload, authorized download, and visibility passed.\n`)
    }
  } catch (error) {
    failure = error
  } finally {
    for (const bucket of uploaded) {
      const removed = await admin.storage.from(bucket).remove([objectPath])
      if (removed.error) {
        const cleanup = new Error(`${bucket} disposable object cleanup failed: ${removed.error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Storage smoke and cleanup failed') : cleanup
      } else {
        const afterRemoval = await admin.storage.from(bucket).download(objectPath)
        if (!afterRemoval.error) {
          const cleanup = new Error(`${bucket} disposable object remains downloadable after removal`)
          failure = failure ? new AggregateError([failure, cleanup], 'Storage smoke and cleanup failed') : cleanup
        }
      }
    }
  }
  if (failure) throw failure
  process.stdout.write('Disposable staging storage objects removed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingStorageSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
