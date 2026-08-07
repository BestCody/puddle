"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

function photoStatus(state, hasPhoto) {
  if (hasPhoto || state === 'open_photo_found') return 'matched'
  if (state === 'no_match') return 'no_match'
  if (state === 'temporary_failure') return 'failed'
  if (state === 'resolving') return 'processing'
  return null
}

function managedPhotoKey(url) {
  try {
    const pathname = new URL(String(url || ''), window.location.origin).pathname
    const marker = '/photos/open/'
    const index = pathname.indexOf(marker)
    if (index < 0) return null
    return decodeURIComponent(pathname.slice(index + 1))
  } catch {
    return null
  }
}

function mergeMedia(item, result) {
  if (!result || typeof result !== 'object') return item
  const photoUrl = result.photo_url || item.photo_url || null
  const storageKey = result.photo_storage_key || managedPhotoKey(photoUrl) || item.private_b2_asset_keys?.photo || null
  return {
    ...item,
    photo_url: photoUrl,
    cover_url: photoUrl || item.cover_url || null,
    photo_provider: result.photo_provider || item.photo_provider || null,
    photo_attribution: result.photo_attribution || item.photo_attribution || null,
    photo_attribution_url: result.photo_attribution_url || item.photo_attribution_url || null,
    photo_license: result.photo_license || item.photo_license || null,
    has_real_photo: Boolean(photoUrl || item.has_real_photo),
    google_place_id: result.google_place_id || item.google_place_id || null,
    google_match_score: result.google_match_score ?? item.google_match_score ?? null,
    media_resolution_state: result.state || item.media_resolution_state || null,
    photo_enrichment_status: photoStatus(result.state, Boolean(photoUrl)) || item.photo_enrichment_status,
    private_b2_asset_keys: storageKey
      ? {
          ...(item.private_b2_asset_keys || {}),
          photo: storageKey,
          cover: storageKey
        }
      : item.private_b2_asset_keys
  }
}

export function useStaticMediaResolution(sourceItem) {
  const [resolved, setResolved] = useState(null)
  const activeRequest = useRef(null)
  const enabled = process.env.NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED === 'true'

  useEffect(() => {
    setResolved(null)
    const item = sourceItem
    if (
      !enabled ||
      !item?.static_catalogue_ephemeral ||
      !item?.static_ref ||
      !item?.content_id ||
      item.photo_url ||
      item.cover_url ||
      item.google_place_id
    ) return undefined

    const requestKey = `${item.content_id}:${item.static_ref}`
    activeRequest.current = requestKey
    let cancelled = false
    let retryTimer = null

    async function resolve(attempt = 0) {
      try {
        const response = await csrfFetch(`/api/static-catalogue/media/${encodeURIComponent(item.content_id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: item.static_ref })
        })
        const result = await response.json().catch(() => ({}))
        if (cancelled || activeRequest.current !== requestKey) return
        if (response.ok) setResolved(result)
        if (response.status === 202 && attempt < 1) {
          retryTimer = window.setTimeout(() => resolve(attempt + 1), 1_500)
        }
      } catch {
        // The placeholder remains usable when providers or the resolver are unavailable.
      }
    }

    resolve()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (activeRequest.current === requestKey) activeRequest.current = null
    }
  }, [
    enabled,
    sourceItem?.content_id,
    sourceItem?.static_catalogue_ephemeral,
    sourceItem?.static_ref,
    sourceItem?.photo_url,
    sourceItem?.cover_url,
    sourceItem?.google_place_id
  ])

  return useMemo(() => mergeMedia(sourceItem, resolved), [sourceItem, resolved])
}