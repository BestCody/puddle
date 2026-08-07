import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeDiscoveryFeedB2Assets } from '../../lib/app/b2-feed-assets.js'
import { b2PrivateDownloadConfiguration } from '../../lib/app/b2-private-download.js'

const config = b2PrivateDownloadConfiguration({
  B2_BUCKET: 'puddle-assets',
  B2_BUCKET_ID: 'bucket-id',
  B2_DOWNLOAD_BASE_URL: 'https://f005.backblazeb2.com/file/puddle-assets',
  B2_DOWNLOAD_KEY_ID: 'download-key',
  B2_DOWNLOAD_APPLICATION_KEY: 'download-secret',
  B2_DOWNLOAD_TOKEN_TTL_SECONDS: '3600'
})

test('discovery feed annotates managed B2 assets without eagerly issuing credentials', async () => {
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
  }, { config })

  const item = feed.items[0]
  assert.equal(item.cover_url, 'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif')
  assert.equal(item.photo_url, 'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif')
  assert.equal(item.photo_urls[0], 'https://f005.backblazeb2.com/file/puddle-assets/photos/open/aa/photo.avif')
  assert.equal(item.photo_urls[1], 'https://images.example/remote.jpg')
  assert.equal(item.category_placeholder_url, 'https://f005.backblazeb2.com/file/puddle-assets/catalogue/placeholders/cafe.svg')
  assert.deepEqual(item.private_b2_asset_keys, {
    cover: 'photos/open/aa/photo.avif',
    photo: 'photos/open/aa/photo.avif',
    placeholder: 'catalogue/placeholders/cafe.svg',
    gallery: ['photos/open/aa/photo.avif', null]
  })
  assert.deepEqual(feed.infrastructure.privateB2Assets, { enabled: true, itemCount: 1, lazy: true })
})

test('unmanaged asset URLs are unchanged and need no private asset annotation', async () => {
  const feed = await authorizeDiscoveryFeedB2Assets({
    items: [{ content_id: 'two', photo_url: 'https://images.example/remote.jpg' }]
  }, { config })
  assert.equal(feed.items[0].photo_url, 'https://images.example/remote.jpg')
  assert.equal(feed.items[0].private_b2_asset_keys, undefined)
})
