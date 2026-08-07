import {
  b2ObjectKeyFromUrl,
  b2PrivateDownloadConfiguration
} from './b2-private-download.js'

function annotateField(value, config) {
  return { value, key: b2ObjectKeyFromUrl(value, config) }
}

function annotateItem(item, config) {
  const cover = annotateField(item?.cover_url, config)
  const photo = annotateField(item?.photo_url, config)
  const placeholder = annotateField(item?.category_placeholder_url, config)
  const gallery = (Array.isArray(item?.photo_urls) ? item.photo_urls : []).map((value) => annotateField(value, config))
  const keys = {
    cover: cover.key,
    photo: photo.key,
    placeholder: placeholder.key,
    gallery: gallery.map((entry) => entry.key)
  }
  const hasPrivateAssets = Boolean(keys.cover || keys.photo || keys.placeholder || keys.gallery.some(Boolean))
  return {
    ...item,
    ...(hasPrivateAssets ? { private_b2_asset_keys: keys } : {})
  }
}

// Keep the historical function name because discovery callers treat this as the
// B2 feed boundary. Credentials are intentionally no longer minted here: the
// browser requests an exact-object grant only for an asset that is actually
// rendered.
export async function authorizeDiscoveryFeedB2Assets(feed, {
  config = b2PrivateDownloadConfiguration()
} = {}) {
  if (!feed || !Array.isArray(feed.items) || !feed.items.length || !config) return feed
  const items = feed.items.map((item) => annotateItem(item, config))
  const privateCount = items.filter((item) => item.private_b2_asset_keys).length
  return {
    ...feed,
    items,
    infrastructure: {
      ...(feed.infrastructure || {}),
      privateB2Assets: {
        enabled: privateCount > 0,
        itemCount: privateCount,
        lazy: true
      }
    }
  }
}
