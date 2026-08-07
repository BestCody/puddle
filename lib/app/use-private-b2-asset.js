"use client"

import { useEffect, useMemo, useState } from 'react'
import { privateB2AssetUrl } from './b2-private-download-client.js'

export function usePrivateB2Asset(url, key, { enabled = true } = {}) {
  const [resolvedUrl, setResolvedUrl] = useState(() => key && enabled ? null : (url || null))

  useEffect(() => {
    if (!url) {
      setResolvedUrl(null)
      return undefined
    }
    if (!key || !enabled) {
      setResolvedUrl(url)
      return undefined
    }

    let cancelled = false
    setResolvedUrl(null)
    privateB2AssetUrl(key)
      .then((freshUrl) => {
        if (!cancelled) setResolvedUrl(freshUrl)
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null)
      })
    return () => { cancelled = true }
  }, [url, key, enabled])

  return resolvedUrl
}

export function usePrivateB2Assets(assets, { enabled = true } = {}) {
  const stableAssets = useMemo(() => (assets || []).map((asset) => ({
    url: asset?.url || null,
    key: asset?.key || null
  })), [assets])
  const [resolved, setResolved] = useState(() => stableAssets.map((asset) => asset.key && enabled ? null : asset.url))

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setResolved(stableAssets.map((asset) => asset.url))
      return () => { cancelled = true }
    }

    setResolved(stableAssets.map((asset) => asset.key ? null : asset.url))
    Promise.all(stableAssets.map(async (asset) => {
      if (!asset.url) return null
      if (!asset.key) return asset.url
      try { return await privateB2AssetUrl(asset.key) }
      catch { return null }
    })).then((urls) => {
      if (!cancelled) setResolved(urls)
    })
    return () => { cancelled = true }
  }, [stableAssets, enabled])

  return resolved
}
