import assert from 'node:assert/strict'
import test from 'node:test'
import { b2Configuration, b2PublicUrl, signB2Request } from '../../lib/app/b2-s3.js'

const config = {
  accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket',
  downloadBaseUrl: 'https://f005.backblazeb2.com/file/bucket',
  publicBaseUrl: 'https://f005.backblazeb2.com/file/bucket',
  endpoint: 'https://s3.us-east-005.backblazeb2.com',
  host: 's3.us-east-005.backblazeb2.com', region: 'us-east-005'
}

test('Backblaze B2 signing is deterministic and uses the endpoint region', () => {
  const options = {
    method: 'PUT', key: 'catalogue/releases/v1/tiles/10/1/2.json', body: Buffer.from('hello'),
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    now: new Date('2026-08-02T12:34:56Z'), config
  }
  const first = signB2Request(options)
  const second = signB2Request(options)
  assert.equal(first.headers.Authorization, second.headers.Authorization)
  assert.match(first.url, /^https:\/\/s3\.us-east-005\.backblazeb2\.com\/bucket\/catalogue\/releases\/v1/)
  assert.match(first.headers.Authorization, /\/us-east-005\/s3\/aws4_request/)
  assert.equal(first.headers['x-amz-date'], '20260802T123456Z')
  assert.match(first.canonicalRequest, /content-encoding:gzip/)
})

test('Backblaze B2 list queries are canonically sorted', () => {
  const signed = signB2Request({
    method: 'GET', query: { prefix: 'catalogue/', 'list-type': '2', 'max-keys': 1000 },
    now: new Date('2026-08-02T12:34:56Z'), config
  })
  assert.match(signed.url, /list-type=2&max-keys=1000&prefix=catalogue%2F$/)
})

test('Backblaze B2 version listing preserves the empty versions subresource', () => {
  const signed = signB2Request({
    method: 'GET', query: { versions: '', 'max-keys': 1000 },
    now: new Date('2026-08-02T12:34:56Z'), config
  })
  assert.match(signed.url, /\?max-keys=1000&versions=$/)
  assert.match(signed.canonicalRequest, /max-keys=1000&versions=/)
})

test('Backblaze configuration rejects non-B2 endpoints and mismatched regions', () => {
  const common = {
    B2_KEY_ID: 'key', B2_APPLICATION_KEY: 'secret', B2_BUCKET: 'bucket',
    B2_DOWNLOAD_BASE_URL: 'https://f005.backblazeb2.com/file/bucket'
  }
  assert.equal(b2Configuration({ ...common, B2_S3_ENDPOINT: 'https://example.com' }), null)
  assert.equal(b2Configuration({ ...common, B2_S3_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com', B2_REGION: 'us-west-004' }), null)
  const resolved = b2Configuration({ ...common, B2_S3_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com' })
  assert.equal(resolved?.region, 'us-east-005')
  assert.equal(resolved?.downloadBaseUrl, common.B2_DOWNLOAD_BASE_URL)
  assert.equal(b2PublicUrl('catalogue/manifest.json', resolved), `${common.B2_DOWNLOAD_BASE_URL}/catalogue/manifest.json`)
})
