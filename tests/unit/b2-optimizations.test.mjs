import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { transformOpenPhotoForB2 } from '../../lib/app/open-photo-b2.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('open-photo storage registers shared Backblaze B2 media objects', async () => {
  const storage = await read('lib/app/open-photo-b2.js')
  const client = await read('lib/app/b2-s3.js')
  const workflow = await read('.github/workflows/photo-enrichment.yml')
  assert.ok(storage.includes("storage_backend: 'b2'"))
  assert.ok(storage.includes(".from('media_objects')"))
  assert.ok(storage.includes("onConflict: 'content_hash'"))
  assert.ok(storage.includes('putB2Object'))
  assert.ok(storage.includes('B2_DOWNLOAD_BASE_URL'))
  assert.ok(client.includes('B2_S3_ENDPOINT'))
  assert.ok(client.includes('backblazeb2'))
  assert.ok(workflow.includes('B2_APPLICATION_KEY'))
  assert.ok(workflow.includes('B2_DOWNLOAD_BASE_URL'))
  assert.equal(workflow.includes('B2_PUBLIC_BASE_URL'), false)
  assert.equal(workflow.includes('R2_SECRET_ACCESS_KEY'), false)
})

test('private B2 downloads use server-only shareFiles credentials and exact-object grants', async () => {
  const privateClient = await read('lib/app/b2-private-download.js')
  const accessRoute = await read('app/api/storage/b2-access/route.js')
  const browserClient = await read('lib/app/b2-private-download-client.js')
  const env = await read('.env.example')
  assert.ok(privateClient.includes("capabilities.has('shareFiles')"))
  assert.ok(privateClient.includes('fileNamePrefix: key'))
  assert.ok(privateClient.includes("url.searchParams.set('Authorization'"))
  assert.ok(accessRoute.includes('supabase.auth.getUser()'))
  assert.ok(accessRoute.includes("'cache-control': 'private, no-store'"))
  assert.ok(accessRoute.includes("searchParams.get('key')"))
  assert.equal(accessRoute.includes("searchParams.get('prefix')"), false)
  assert.ok(browserClient.includes('/api/storage/b2-access?key='))
  assert.equal(browserClient.includes('/api/storage/b2-access?prefix='), false)
  assert.ok(env.includes('B2_DOWNLOAD_KEY_ID='))
  assert.ok(env.includes('B2_DOWNLOAD_APPLICATION_KEY='))
  assert.equal(env.includes('NEXT_PUBLIC_B2_'), false)
})

test('active catalogue jobs use B2 commands and supported write headers', async () => {
  const publisher = await read('scripts/publish-static-catalogue-b2.mjs')
  const cleanup = await read('scripts/cleanup-b2-assets.mjs')
  const overlay = await read('lib/app/static-media-overlay.js')
  const packageJson = await read('package.json')
  assert.ok(publisher.includes('putB2Object'))
  assert.ok(cleanup.includes("media.storageBackend === 'b2'"))
  assert.ok(overlay.includes('b2Request'))
  assert.equal(publisher.includes("'if-match'"), false)
  assert.equal(publisher.includes("'if-none-match'"), false)
  assert.equal(cleanup.includes("'if-match'"), false)
  assert.ok(packageJson.includes('locations:catalogue:publish-b2'))
  assert.equal(packageJson.includes('locations:catalogue:publish-r2'), false)
})

test('Backblaze image processing produces bounded AVIF metadata', async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 120, g: 160, b: 200 } }
  }).jpeg({ quality: 90 }).toBuffer()
  const result = await transformOpenPhotoForB2(source, { targetBytes: 45_000, hardMaxBytes: 60_000 })
  assert.ok(result.byteSize > 0 && result.byteSize <= 60_000)
  assert.match(result.contentHash, /^[0-9a-f]{64}$/)
  assert.match(result.perceptualHash, /^[0-9a-f]{16}$/)
  assert.ok(result.width <= 720)
  assert.ok(result.height <= 450)
})
