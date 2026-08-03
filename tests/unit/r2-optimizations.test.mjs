import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { transformOpenPhotoForR2 } from '../../lib/app/open-photo-r2.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('open-photo importer uploads processed assets directly to R2', async () => {
  const importer = await read('scripts/import-open-location-photos.mjs')
  const runner = await read('scripts/enrich-open-location-photos.mjs')
  const workflow = await read('.github/workflows/photo-enrichment.yml')
  assert.ok(importer.includes('storeOpenPhotoInR2'))
  assert.ok(importer.includes('storage_backend: stored.storageBackend'))
  assert.ok(importer.includes('content_hash: stored.contentHash'))
  assert.equal(importer.includes('admin.storage.from(BUCKET)'), false)
  assert.equal(importer.includes("contentType: 'image/jpeg'"), false)
  assert.equal(runner.includes('PHOTO_ENRICH_MIGRATOR'), false)
  assert.equal(workflow.includes('PHOTO_ENRICH_MIGRATOR'), false)
  assert.equal(workflow.includes('OPEN_PHOTO_R2_MIGRATION_LIMIT'), false)
})

test('direct R2 image processing produces bounded AVIF metadata', async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 120, g: 160, b: 200 } }
  }).jpeg({ quality: 90 }).toBuffer()
  const result = await transformOpenPhotoForR2(source, { targetBytes: 45_000, hardMaxBytes: 60_000 })
  assert.ok(result.byteSize > 0 && result.byteSize <= 60_000)
  assert.match(result.contentHash, /^[0-9a-f]{64}$/)
  assert.match(result.perceptualHash, /^[0-9a-f]{16}$/)
  assert.ok(result.width <= 720)
  assert.ok(result.height <= 450)
})
