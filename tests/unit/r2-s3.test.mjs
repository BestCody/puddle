import assert from 'node:assert/strict'
import test from 'node:test'
import { signR2Request } from '../../lib/app/r2-s3.js'

const config = {
  accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket',
  publicBaseUrl: 'https://assets.example.com', endpoint: 'https://account.r2.cloudflarestorage.com'
}

test('R2 signing is deterministic and includes immutable object headers', () => {
  const options = {
    method: 'PUT', key: 'catalogue/releases/v1/tiles/10/1/2.json', body: Buffer.from('hello'),
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    now: new Date('2026-08-02T12:34:56Z'), config
  }
  const first = signR2Request(options)
  const second = signR2Request(options)
  assert.equal(first.headers.Authorization, second.headers.Authorization)
  assert.match(first.url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/bucket\/catalogue\/releases\/v1/)
  assert.equal(first.headers['x-amz-date'], '20260802T123456Z')
  assert.match(first.canonicalRequest, /content-encoding:gzip/)
})

test('R2 list queries are canonically sorted', () => {
  const signed = signR2Request({
    method: 'GET', query: { prefix: 'catalogue/', 'list-type': '2', 'max-keys': 1000 },
    now: new Date('2026-08-02T12:34:56Z'), config
  })
  assert.match(signed.url, /list-type=2&max-keys=1000&prefix=catalogue%2F$/)
})
