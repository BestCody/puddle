"use client"

import { useEffect, useMemo, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

export function useStaticCatalogueDetails(item, enabled) {
  const [resolved, setResolved] = useState({ contentId: null, data: null })

  useEffect(() => {
    const contentId = item?.content_id || null
    const reference = item?.static_ref || null
    if (!enabled || !item?.static_catalogue_ephemeral || !contentId || !reference) return undefined
    if (resolved.contentId === contentId && resolved.data) return undefined

    const controller = new AbortController()
    let cancelled = false

    csrfFetch(`/api/static-catalogue/details/${encodeURIComponent(contentId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: reference }),
      signal: controller.signal
    })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data && typeof data === 'object') setResolved({ contentId, data })
      })
      .catch(() => {})

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, item?.content_id, item?.static_catalogue_ephemeral, item?.static_ref, resolved.contentId, resolved.data])

  return useMemo(() => {
    if (!resolved.data || resolved.contentId !== item?.content_id) return item
    return { ...item, ...resolved.data }
  }, [item, resolved])
}
