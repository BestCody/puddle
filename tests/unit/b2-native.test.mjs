import test from 'node:test'
import assert from 'node:assert/strict'
import { b2ConfigFromEnv, b2PublicUrl, isB2Configured, joinB2Key, sha1Hex, sha256Hex } from '../../lib/storage/b2-native.js'

test('B2 keys are content-addressable and path-safe', () => {
  assert.equal(joinB2Key('/photos/', '/by-sha256//', 'ab', 'abc.jpg'), 'photos/by-sha256/ab/abc.jpg')
  assert.equal(b2PublicUrl('https://media.puddle.app/', 'photos/by-sha256/a b.jpg'), 'https://media.puddle.app/photos/by-sha256/a%20b.jpg')
  assert.equal(sha1Hex(Buffer.from('puddle')), 'bce302f015d52217d793e901857db1eecd5a8481')
  assert.equal(sha256Hex(Buffer.from('puddle')).length, 64)
})

test('B2 config requires credentials and a bucket', () => {
  const env = {
    B2_MEDIA_APPLICATION_KEY_ID: 'id', B2_MEDIA_APPLICATION_KEY: 'secret',
    B2_MEDIA_BUCKET_ID: 'bucket-id', B2_MEDIA_PUBLIC_BASE_URL: 'https://media.puddle.app'
  }
  assert.equal(isB2Configured('B2_MEDIA', env), true)
  assert.deepEqual(b2ConfigFromEnv('B2_MEDIA', env), {
    keyId: 'id', applicationKey: 'secret', bucketId: 'bucket-id', bucketName: '', publicBaseUrl: 'https://media.puddle.app'
  })
  assert.equal(isB2Configured('B2_DATA', env), false)
})
