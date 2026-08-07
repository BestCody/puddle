"use client"

import { useEffect, useState } from 'react'
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
