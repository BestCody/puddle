"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

const resolvedMediaCache = new Map()
const inFlightRequests = new Map()
const openPrefetchAttempted = new Set()

function resolverEnabled() {
  return process.env.NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED === 'true'
}

function itemKey(item) {
  return item?.content_id ? String(item.content_id) : null
}

function isStaticResolvable(item) {
  return Boolean(
    item?.static_catalogue_ephemeral &&
    item?.static_ref &&
    item?.content_id
  )
}

function hasKnownMedia(item) {
  return Boolean(item?.photo_url || item?.cover_url || item?.google_place_id)
}

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

function cacheableMedia(result) {
  return Boolean(
    result?.photo_url ||
    result?.google_place_id ||
    ['open_photo_found', 'google_matched', 'no_match'].includes(String(result?.state || ''))
  )
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function requestStaticMedia(item, mode) {
  if (!resolverEnabled() || !isStaticResolvable(item) || hasKnownMedia(item)) return { status: 204, result: null }
  const key = itemKey(item)
  const cached = resolvedMediaCache.get(key)
  if (cached) return { status: 200, result: cached }

  if (mode === 'open_only') {
    if (openPrefetchAttempted.has(key)) return { status: 204, result: null }
    openPrefetchAttempted.add(key)
  }

  if (mode === 'full') {
    const prefetch = inFlightRequests.get(`open_only:${key}`)
    if (prefetch) {
      await prefetch.catch(() => null)
      const warmed = resolvedMediaCache.get(key)
      if (warmed) return { status: 200, result: warmed }
    }
  }

  const inFlightKey = `${mode}:${key}`
  if (inFlightRequests.has(inFlightKey)) return inFlightRequests.get(inFlightKey)

  const task = (async () => {
    const response = await csrfFetch(`/api/static-catalogue/media/${encodeURIComponent(item.content_id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: item.static_ref, mode })
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok && cacheableMedia(result)) resolvedMediaCache.set(key, result)
    return { status: response.status, result }
  })().finally(() => {
    if (inFlightRequests.get(inFlightKey) === task) inFlightRequests.delete(inFlightKey)
  })

  inFlightRequests.set(inFlightKey, task)
  return task
}

async function resolveVisibleStaticMedia(item) {
  let outcome = await requestStaticMedia(item, 'full')
  for (let attempt = 0; outcome.status === 202 && attempt < 3; attempt += 1) {
    await sleep(500 * (attempt + 1))
    outcome = await requestStaticMedia(item, 'full')
  }
  return outcome.result
}

export async function prefetchStaticMedia(items, { limit = 3, concurrency = 3 } = {}) {
  if (!resolverEnabled()) return []
  const candidates = (items || [])
    .filter((item) => isStaticResolvable(item) && !hasKnownMedia(item) && !resolvedMediaCache.has(itemKey(item)))
    .slice(0, Math.max(0, Math.min(6, Number(limit) || 0)))
  if (!candidates.length) return []

  const results = new Array(candidates.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(candidates.length, Math.min(3, Number(concurrency) || 1)))
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < candidates.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = (await requestStaticMedia(candidates[index], 'open_only')).result
      } catch {
        results[index] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

export function useStaticMediaResolution(sourceItem) {
  const [resolved, setResolved] = useState(null)
  const activeRequest = useRef(null)
  const enabled = resolverEnabled()

  useEffect(() => {
    const item = sourceItem
    const key = itemKey(item)
    const cached = key ? resolvedMediaCache.get(key) || null : null
    setResolved(cached)
    if (!enabled || !isStaticResolvable(item) || hasKnownMedia(item) || cached) return undefined

    activeRequest.current = key
    let cancelled = false
    resolveVisibleStaticMedia(item)
      .then((result) => {
        if (!cancelled && activeRequest.current === key && result) setResolved(result)
      })
      .catch(() => {
        // Swiping remains usable when providers or the resolver are unavailable.
      })

    return () => {
      cancelled = true
      if (activeRequest.current === key) activeRequest.current = null
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
