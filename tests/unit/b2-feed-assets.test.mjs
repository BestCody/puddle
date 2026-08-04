import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeDiscoveryFeedB2Assets } from '../../lib/app/b2-feed-assets.js'
import { b2PrivateDownloadConfiguration, clearPrivateB2DownloadCacheForTests } from '../../lib/app/b2-private-download.js'

const config = b2PrivateDownloadConfiguration({
  B2_BUCKET: 'puddle-assets',
  B2_BUCKET_ID: 'bucket-id',
  B2_DOWNLOAD_BASE_URL: 'https://f005.backblazeb2.com/file/puddle-assets',
  B2_DOWNLOAD_KEY_ID: 'download-key',
  B2_DOWNLOAD_APPLICATION_KEY: 'download-secret',
  B2_DOWNLOAD_TOKEN_TTL_SECONDS: '3600'
})

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
    return Response.json({ authorizationToken: String(options.body).includes('photos/open/') ? 'photo-token' : 'catalogue-token' })
  }
  return { requests, fetchImpl }
}

test('discovery feed replaces managed B2 assets with prefix-authorized direct URLs', async () => {
  clearPrivateB2DownloadCacheForTests()
  const { requests, fetchImpl } = mockBackblaze()
  const feed = await authorizeDiscoveryFeedB2Assets({
    items: [{
      content_id: 'one',
      cover_url: 'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif',
      photo_url: 'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif',
      photo_urls: [
        'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif',
        'https://images.example/remote.jpg'
      ],
      category_placeholder_url: 'https://f005.backblazeb2.com/file/puddle-assets/catalogue/placeholders/cafe.svg'
    }],
    infrastructure: { catalogue: 'b2' }
  }, { config, fetchImpl, now: 1_000_000 })

  const item = feed.items[0]
  assert.equal(new URL(item.cover_url).searchParams.get('Authorization'), 'photo-token')
  assert.equal(new URL(item.photo_url).searchParams.get('Authorization'), 'photo-token')
  assert.equal(new URL(item.photo_urls[0]).searchParams.get('Authorization'), 'photo-token')
  assert.equal(item.photo_urls[1], 'https://images.example/remote.jpg')
  assert.equal(new URL(item.category_placeholder_url).searchParams.get('Authorization'), 'catalogue-token')
  assert.deepEqual(item.private_b2_asset_keys, {
    cover: 'photos/open/aa/photo.avif',
    photo: 'photos/open/aa/photo.avif',
    placeholder: 'catalogue/placeholders/cafe.svg',
    gallery: ['photos/open/aa/photo.avif', null]
  })
  assert.deepEqual(feed.infrastructure.privateB2Assets, { enabled: true, itemCount: 1 })
  assert.equal(requests.filter((entry) => entry.url.includes('b2_authorize_account')).length, 1)
  assert.equal(requests.filter((entry) => entry.url.includes('b2_get_download_authorization')).length, 2)
})

test('unmanaged asset URLs are unchanged and do not call Backblaze', async () => {
  clearPrivateB2DownloadCacheForTests()
  const { requests, fetchImpl } = mockBackblaze()
  const feed = await authorizeDiscoveryFeedB2Assets({
    items: [{ content_id: 'two', photo_url: 'https://images.example/remote.jpg' }]
  }, { config, fetchImpl, now: 1_000_000 })
  assert.equal(feed.items[0].photo_url, 'https://images.example/remote.jpg')
  assert.equal(feed.items[0].private_b2_asset_keys, undefined)
  assert.equal(requests.length, 0)
})
