import assert from 'node:assert/strict'
import test from 'node:test'
import { storageUploadBody } from '../../lib/media/storage-upload-body.js'

test('storage upload body preserves every binary byte without UTF-8 coercion', () => {
  const source = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x80, 0x00, 0xef, 0xbf, 0xbd, 0x7f])
  const body = storageUploadBody(source)

  assert.ok(body instanceof ArrayBuffer)
  assert.deepEqual([...new Uint8Array(body)], [...source])
  assert.equal(body.byteLength, source.byteLength)
})

test('storage upload body respects Buffer offsets and does not leak pooled bytes', () => {
  const pooled = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
  const view = pooled.subarray(2, 6)
  const body = storageUploadBody(view)

  assert.deepEqual([...new Uint8Array(body)], [3, 4, 5, 6])
  assert.equal(body.byteLength, 4)
})
