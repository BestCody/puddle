import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizeB2DownloadUrl,
  b2DownloadUrlForKey,
  b2ObjectKeyFromUrl,
  b2PrivateDownloadConfiguration,
  clearPrivateB2DownloadCacheForTests,
  getB2DownloadAuthorization,
  managedB2PrefixForKey
} from '../../lib/app/b2-private-download.js'

const env = {
  B2_BUCKET: 'puddle-assets',
  B2_BUCKET_ID: 'bucket-id',
  B2_DOWNLOAD_BASE_URL: 'https://f005.backblazeb2.com/file/puddle-assets',
  B2_DOWNLOAD_KEY_ID: 'download-key',
  B2_DOWNLOAD_APPLICATION_KEY: 'download-secret',
  B2_DOWNLOAD_TOKEN_TTL_SECONDS: '3600'
}

function mockBackblaze() {
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('b2_authorize_account')) {
      return Response.json({
        authorizationToken: 'account-token',
        apiInfo: {
          storageApi: {
            apiUrl: 'https://api005.backblazeb2.com',
            allowed: {
              capabilities: ['shareFiles'],
              buckets: [{ id: 'bucket-id', name: 'puddle-assets' }]
            }
          }
        }
      })
    }
    if (String(url).includes('b2_get_download_authorization')) {
      return Response.json({ authorizationToken: 'prefix-token' })
    }
    return new Response('asset', { status: 200 })
  }
  return { requests, fetchImpl }
}

test('private B2 configuration accepts only the configured HTTPS bucket download path', () => {
  const config = b2PrivateDownloadConfiguration(env)
  assert.equal(config.downloadBaseUrl, 'https://f005.backblazeb2.com/file/puddle-assets')
  assert.equal(config.tokenTtlSeconds, 3600)
  assert.equal(b2PrivateDownloadConfiguration({ ...env, B2_DOWNLOAD_BASE_URL: 'https://example.com/file/puddle-assets' }), null)
  assert.equal(b2PrivateDownloadConfiguration({ ...env, B2_DOWNLOAD_BASE_URL: 'https://f005.backblazeb2.com/file/other' }), null)
})

test('managed object parsing is restricted to catalogue and open-photo prefixes', () => {
  const config = b2PrivateDownloadConfiguration(env)
  assert.equal(managedB2PrefixForKey('catalogue/manifest.json'), 'catalogue/')
  assert.equal(managedB2PrefixForKey('photos/open/aa/file.avif'), 'photos/open/')
  assert.equal(managedB2PrefixForKey('private/users/file.jpg'), null)
  assert.equal(
    b2ObjectKeyFromUrl('https://f005.backblazeb2.com/file/puddle-assets/catalogue/manifest.json', config),
    'catalogue/manifest.json'
  )
  assert.equal(b2ObjectKeyFromUrl('https://evil.example/catalogue/manifest.json', config), null)
  assert.equal(b2DownloadUrlForKey('private/users/file.jpg', config), null)
})

test('download authorization uses shareFiles, limits the prefix, and caches the token', async () => {
  clearPrivateB2DownloadCacheForTests()
  const config = b2PrivateDownloadConfiguration(env)
  const { requests, fetchImpl } = mockBackblaze()
  const first = await getB2DownloadAuthorization('catalogue/', { config, fetchImpl, now: 1_000_000 })
  const second = await getB2DownloadAuthorization('catalogue/', { config, fetchImpl, now: 1_001_000 })
  assert.equal(first.authorizationToken, 'prefix-token')
  assert.equal(second.authorizationToken, 'prefix-token')
  assert.equal(requests.length, 2)
  assert.match(requests[0].options.headers.Authorization, /^Basic /)
  const body = JSON.parse(requests[1].options.body)
  assert.deepEqual(body, {
    bucketId: 'bucket-id',
    fileNamePrefix: 'catalogue/',
    validDurationInSeconds: 3600
  })
  await assert.rejects(() => getB2DownloadAuthorization('users/', { config, fetchImpl }), /not allowed/i)
})

test('managed private URLs receive the case-sensitive Authorization query parameter', async () => {
  clearPrivateB2DownloadCacheForTests()
  const config = b2PrivateDownloadConfiguration(env)
  const { fetchImpl } = mockBackblaze()
  const signed = await authorizeB2DownloadUrl(
    'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif',
    { config, fetchImpl, now: 2_000_000 }
  )
  const url = new URL(signed)
  assert.equal(url.searchParams.get('Authorization'), 'prefix-token')
  assert.equal(url.searchParams.has('authorization'), false)
  assert.equal(url.pathname, '/file/puddle-assets/photos/open/aa/photo.avif')
  assert.equal(await authorizeB2DownloadUrl('https://images.example/photo.jpg', { config, fetchImpl }), 'https://images.example/photo.jpg')
})

test('download keys without shareFiles fail closed', async () => {
  clearPrivateB2DownloadCacheForTests()
  const config = b2PrivateDownloadConfiguration(env)
  const fetchImpl = async () => Response.json({
    authorizationToken: 'account-token',
    apiInfo: {
      storageApi: {
        apiUrl: 'https://api005.backblazeb2.com',
        allowed: { capabilities: ['readFiles'], buckets: [{ id: 'bucket-id', name: 'puddle-assets' }] }
      }
    }
  })
  await assert.rejects(
    () => getB2DownloadAuthorization('catalogue/', { config, fetchImpl, now: 3_000_000 }),
    /shareFiles/
  )
})
