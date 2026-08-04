import {
  authorizeB2DownloadUrl,
  b2ObjectKeyFromUrl,
  b2PrivateDownloadConfiguration
} from './b2-private-download.js'

async function authorizeField(value, config) {
  const key = b2ObjectKeyFromUrl(value, config)
  if (!key) return { value, key: null }
  return {
    value: await authorizeB2DownloadUrl(value, { config }),
    key
  }
}

async function authorizeItem(item, config) {
  const [cover, photo, placeholder, gallery] = await Promise.all([
    authorizeField(item?.cover_url, config),
    authorizeField(item?.photo_url, config),
    authorizeField(item?.category_placeholder_url, config),
    Promise.all((Array.isArray(item?.photo_urls) ? item.photo_urls : []).map((value) => authorizeField(value, config)))
  ])
  const keys = {
    cover: cover.key,
    photo: photo.key,
    placeholder: placeholder.key,
    gallery: gallery.map((entry) => entry.key)
  }
  const hasPrivateAssets = Boolean(keys.cover || keys.photo || keys.placeholder || keys.gallery.some(Boolean))
  return {
    ...item,
    cover_url: cover.value,
    photo_url: photo.value,
    category_placeholder_url: placeholder.value,
    ...(Array.isArray(item?.photo_urls) ? { photo_urls: gallery.map((entry) => entry.value) } : {}),
    ...(hasPrivateAssets ? { private_b2_asset_keys: keys } : {})
  }
}

export async function authorizeDiscoveryFeedB2Assets(feed, {
  config = b2PrivateDownloadConfiguration()
} = {}) {
  if (!feed || !Array.isArray(feed.items) || !feed.items.length || !config) return feed
  const items = await Promise.all(feed.items.map((item) => authorizeItem(item, config)))
  const privateCount = items.filter((item) => item.private_b2_asset_keys).length
  return {
    ...feed,
    items,
    infrastructure: {
      ...(feed.infrastructure || {}),
      privateB2Assets: {
        enabled: privateCount > 0,
        itemCount: privateCount
      }
    }
  }
}
