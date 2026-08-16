"use client"

import { getImageProps } from 'next/image'
import { useEffect, useRef } from 'react'
import { DISCOVERY_IMAGE_SIZES, canOptimizeDiscoveryImage } from '@/lib/media/discovery-image'

const DEFAULT_PRELOAD_AHEAD = 2

function primaryPhotoUrls(item) {
  if (!item || typeof item !== 'object') return []
  return [
    ...(Array.isArray(item.photo_urls) ? item.photo_urls : []),
    item.photo_url,
    item.cover_url
  ].filter((value) => typeof value === 'string' && value.trim())
}

export function preferredDiscoveryPhotoUrl(item) {
  const candidates = [
    ...primaryPhotoUrls(item),
    item?.category_placeholder_url
  ]
  return candidates.find((value) => typeof value === 'string' && value.trim()) || null
}

function preloadBudget(requested) {
  if (typeof navigator === 'undefined') return requested
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection?.saveData) return 0
  const effectiveType = String(connection?.effectiveType || '')
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return Math.min(1, requested)
  return requested
}

function preloadProps(item, url) {
  const optimized = primaryPhotoUrls(item).includes(url) && canOptimizeDiscoveryImage(url)
  if (!optimized) return { src: url, srcSet: null, sizes: null }
  const { props } = getImageProps({
    src: url,
    alt: '',
    fill: true,
    sizes: DISCOVERY_IMAGE_SIZES
  })
  return { src: props.src, srcSet: props.srcSet || null, sizes: props.sizes || null }
}

export function DiscoveryPhotoPreloader({ items, index, ahead = DEFAULT_PRELOAD_AHEAD }) {
  const seen = useRef(new Set())
  const inFlight = useRef(new Map())

  useEffect(() => {
    if (typeof window === 'undefined' || !Array.isArray(items)) return
    const budget = preloadBudget(Math.max(0, Number(ahead) || 0))
    if (!budget) return

    const upcoming = items.slice(index + 1, index + 1 + budget)
    for (const item of upcoming) {
      const url = preferredDiscoveryPhotoUrl(item)
      if (!url || seen.current.has(url) || inFlight.current.has(url)) continue

      const source = preloadProps(item, url)
      const image = new window.Image()
      image.decoding = 'async'
      if ('fetchPriority' in image) image.fetchPriority = 'low'
      const complete = () => {
        seen.current.add(url)
        inFlight.current.delete(url)
      }
      image.onload = complete
      image.onerror = complete
      inFlight.current.set(url, image)
      if (source.sizes) image.sizes = source.sizes
      if (source.srcSet) image.srcset = source.srcSet
      image.src = source.src
    }
  }, [ahead, index, items])

  return null
}
