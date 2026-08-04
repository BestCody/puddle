"use client"

import { useEffect, useState } from 'react'
import { privateB2AssetUrl } from './b2-private-download-client.js'

export function usePrivateB2Asset(url, key) {
  const [resolvedUrl, setResolvedUrl] = useState(url || null)

  useEffect(() => {
    setResolvedUrl(url || null)
    if (!url || !key || typeof Image === 'undefined') return undefined

    let cancelled = false
    const probe = new Image()
    probe.onload = () => {}
    probe.onerror = () => {
      privateB2AssetUrl(key, { force: true })
        .then((freshUrl) => {
          if (!cancelled) setResolvedUrl(freshUrl)
        })
        .catch(() => {})
    }
    probe.src = url
    return () => {
      cancelled = true
      probe.onload = null
      probe.onerror = null
    }
  }, [url, key])

  return resolvedUrl
}
