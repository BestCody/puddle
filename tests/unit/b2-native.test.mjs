import test from 'node:test'
import assert from 'node:assert/strict'
import { b2ConfigFromEnv, isB2Configured, joinB2Key, sha1Hex, sha256Hex } from '../../lib/storage/b2-native.js'

test('B2 keys are content-addressable and path-safe', () => {
  assert.equal(joinB2Key('/photos/', '/by-sha256//', 'ab', 'abc.jpg'), 'photos/by-sha256/ab/abc.jpg')
  assert.equal(sha1Hex(Buffer.from('puddle')), 'bce302f015d52217d793e901857db1eecd5a8481')
  assert.equal(sha256Hex(Buffer.from('puddle')).length, 64)
})

test('B2 config requires credentials and a bucket without a public delivery URL', () => {
  const env = {
    B2_MEDIA_APPLICATION_KEY_ID: 'id', B2_MEDIA_APPLICATION_KEY: 'secret',
    B2_MEDIA_BUCKET_ID: 'bucket-id'
  }
  assert.equal(isB2Configured('B2_MEDIA', env), true)
  assert.deepEqual(b2ConfigFromEnv('B2_MEDIA', env), {
    keyId: 'id', applicationKey: 'secret', bucketId: 'bucket-id', bucketName: ''
  })
  assert.equal(isB2Configured('B2_DATA', env), false)
})

test('B2 data and media configs retain historical credential-name fallbacks during scoped-key rollout', () => {
  const env = {
    B2_KEY_ID: 'legacy-id',
    B2_APPLICATION_KEY: 'legacy-secret',
    B2_BUCKET: 'puddle-assets'
  }

  assert.deepEqual(b2ConfigFromEnv('B2_DATA', env), {
    keyId: 'legacy-id', applicationKey: 'legacy-secret', bucketId: '', bucketName: 'puddle-assets'
  })
  assert.deepEqual(b2ConfigFromEnv('B2_MEDIA', env), {
    keyId: 'legacy-id', applicationKey: 'legacy-secret', bucketId: '', bucketName: 'puddle-assets'
  })
  assert.equal(isB2Configured('B2_DATA', env), true)
  assert.equal(isB2Configured('B2_MEDIA', env), true)
})

test('scoped B2 variables take precedence over credential-name fallbacks', () => {
  const env = {
    B2_KEY_ID: 'legacy-id', B2_APPLICATION_KEY: 'legacy-secret', B2_BUCKET: 'puddle-assets',
    B2_DATA_APPLICATION_KEY_ID: 'data-id', B2_DATA_APPLICATION_KEY: 'data-secret', B2_DATA_BUCKET_NAME: 'puddle-data'
  }
  const config = b2ConfigFromEnv('B2_DATA', env)
  assert.equal(config.keyId, 'data-id')
  assert.equal(config.applicationKey, 'data-secret')
  assert.equal(config.bucketName, 'puddle-data')
})
