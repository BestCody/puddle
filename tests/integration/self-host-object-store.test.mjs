import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { downloadSelfHostObject, selfHostObjectConfig } from '../../lib/storage/self-host-object-store.js'

const env = {
  OBJECT_STORAGE_ENDPOINT: 'http://objects:8333',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'puddle-assets',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'test-id',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'
}

test('self-host object store requires an explicit endpoint and credentials', () => {
  assert.deepEqual(selfHostObjectConfig(env), {
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    region: env.OBJECT_STORAGE_REGION,
    bucket: env.OBJECT_STORAGE_BUCKET,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  })
  assert.throws(() => selfHostObjectConfig({ ...env, OBJECT_STORAGE_SECRET_ACCESS_KEY: '' }), /OBJECT_STORAGE_SECRET_ACCESS_KEY/)
  assert.throws(() => selfHostObjectConfig({ ...env, OBJECT_STORAGE_ENDPOINT: 'http://secret@objects:8333' }), /bare HTTP/)
})

test('self-host object reads preserve keys and enforce the byte budget while streaming', async () => {
  let requested
  const client = { send: async (command) => {
    requested = command.input
    return { ContentLength: 3, Body: (async function* () { yield Buffer.from('abc') })() }
  } }
  assert.equal((await downloadSelfHostObject('data/search/active.json', { env, client, maxBytes: 3 })).toString(), 'abc')
  assert.deepEqual(requested, { Bucket: 'puddle-assets', Key: 'data/search/active.json' })
  await assert.rejects(() => downloadSelfHostObject('key', { env, client, maxBytes: 2 }), /fetch budget/)
  const unknownLength = { send: async () => ({ Body: (async function* () { yield Buffer.from('ab'); yield Buffer.from('cd') })() }) }
  await assert.rejects(() => downloadSelfHostObject('key', { env, client: unknownLength, maxBytes: 3 }), /fetch budget/)
})

test('only explicit missingOk converts absent objects into null', async () => {
  const client = { send: async () => { throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }) } }
  assert.equal(await downloadSelfHostObject('missing', { env, client, missingOk: true }), null)
  await assert.rejects(() => downloadSelfHostObject('missing', { env, client }), /missing/)
})

test('self-host object store round-trips against a live S3 service', {
  skip: !process.env.PUDDLE_TEST_S3_ENDPOINT
}, async () => {
  const live = {
    ...env,
    OBJECT_STORAGE_ENDPOINT: process.env.PUDDLE_TEST_S3_ENDPOINT,
    OBJECT_STORAGE_ACCESS_KEY_ID: process.env.PUDDLE_TEST_S3_ACCESS_KEY_ID,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: process.env.PUDDLE_TEST_S3_SECRET_ACCESS_KEY
  }
  assert.equal(new URL(live.OBJECT_STORAGE_ENDPOINT).hostname, '127.0.0.1', 'Live integration test only supports loopback S3.')
  const client = new S3Client({
    endpoint: live.OBJECT_STORAGE_ENDPOINT,
    region: live.OBJECT_STORAGE_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: live.OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey: live.OBJECT_STORAGE_SECRET_ACCESS_KEY }
  })
  const key = `data/search/test-${randomUUID()}.json`
  const body = Buffer.from('self-host storage round trip')
  try {
    await client.send(new PutObjectCommand({ Bucket: live.OBJECT_STORAGE_BUCKET, Key: key, Body: body }))
    assert.deepEqual(await downloadSelfHostObject(key, { env: live }), body)
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: live.OBJECT_STORAGE_BUCKET, Key: key }))
    client.destroy()
  }
})
