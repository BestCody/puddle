import assert from 'node:assert/strict'
import test from 'node:test'
import { storageUploadBody } from '../../lib/media/storage-upload-body.js'

async function bytes(blob) {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

test('storage upload body preserves every binary byte without UTF-8 coercion', async () => {
  const source = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x80, 0x00, 0xef, 0xbf, 0xbd, 0x7f])
  const body = storageUploadBody(source, 'image/webp')

  assert.ok(body instanceof Blob)
  assert.equal(body.type, 'image/webp')
  assert.equal(body.size, source.byteLength)
  assert.deepEqual(await bytes(body), [...source])
})

test('storage upload body respects Buffer offsets and does not leak pooled bytes', async () => {
  const pooled = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
  const view = pooled.subarray(2, 6)
  const body = storageUploadBody(view, 'application/pdf')

  assert.equal(body.type, 'application/pdf')
  assert.equal(body.size, 4)
  assert.deepEqual(await bytes(body), [3, 4, 5, 6])
})
