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
  assert.ok(client.includes('backblazeb2.com'))
  assert.ok(workflow.includes('B2_APPLICATION_KEY'))
  assert.equal(workflow.includes('R2_SECRET_ACCESS_KEY'), false)
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
