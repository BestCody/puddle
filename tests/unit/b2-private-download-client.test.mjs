import assert from 'node:assert/strict'
import test from 'node:test'
import { clearPrivateB2ClientCacheForTests, privateB2AssetUrl } from '../../lib/app/b2-private-download-client.js'

function mockAccess() {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options })
    const key = new URL(String(url), 'https://puddle.test').searchParams.get('key')
    return Response.json({
      baseUrl: 'https://f005.backblazeb2.com/file/puddle-assets',
      key,
      authorizationToken: `token:${key}`,
      expiresAt: new Date('2030-01-01T00:00:00Z').toISOString()
    })
  }
  return { requests, fetchImpl }
}

test('browser helper requests an exact object grant and builds a direct B2 URL', async () => {
  clearPrivateB2ClientCacheForTests()
  const { requests, fetchImpl } = mockAccess()
  const key = 'photos/open/aa/photo.avif'
  const url = await privateB2AssetUrl(key, { fetchImpl, now: 1_000_000 })
  assert.equal(requests[0].url, `/api/storage/b2-access?key=${encodeURIComponent(key)}`)
  assert.equal(requests[0].options.credentials, 'same-origin')
  assert.equal(requests[0].options.cache, 'no-store')
  assert.equal(new URL(url).searchParams.get('Authorization'), `token:${key}`)
  assert.equal(new URL(url).pathname, '/file/puddle-assets/photos/open/aa/photo.avif')
})

test('browser helper caches only the same object and never reuses a sibling grant', async () => {
  clearPrivateB2ClientCacheForTests()
  const { requests, fetchImpl } = mockAccess()
  await privateB2AssetUrl('catalogue/placeholders/cafe.svg', { fetchImpl, now: 1_000_000 })
  await privateB2AssetUrl('catalogue/placeholders/cafe.svg', { fetchImpl, now: 1_001_000 })
  assert.equal(requests.length, 1)
  await privateB2AssetUrl('catalogue/placeholders/park.svg', { fetchImpl, now: 1_001_500 })
  assert.equal(requests.length, 2, 'a sibling object must request its own grant')
  await privateB2AssetUrl('catalogue/placeholders/park.svg', { fetchImpl, force: true, now: 1_002_000 })
  assert.equal(requests.length, 3)
})

test('browser helper rejects keys outside managed prefixes and mismatched access responses', async () => {
  clearPrivateB2ClientCacheForTests()
  await assert.rejects(() => privateB2AssetUrl('users/private.jpg'), /outside an allowed prefix/i)
  const fetchImpl = async () => Response.json({
    baseUrl: 'https://f005.backblazeb2.com/file/puddle-assets',
    key: 'photos/open/other.avif',
    authorizationToken: 'token',
    expiresAt: new Date('2030-01-01T00:00:00Z').toISOString()
  })
  await assert.rejects(() => privateB2AssetUrl('photos/open/photo.avif', { fetchImpl }), /invalid response/i)
})
