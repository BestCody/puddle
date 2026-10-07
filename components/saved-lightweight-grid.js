"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { LocationVisualPreview } from '@/components/location-visual-preview'
import { resolveSavedPreviewBatch } from '@/lib/app/saved-preview-results'

function categoryLabel(value) {
  return String(value || 'Saved place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function SavedCardVisual({ className, href, ready, title, image, latitude, longitude, children, onOpen, loading = 'lazy' }) {
  function handleOpen(event) {
    if (onOpen) {
      event.preventDefault()
      onOpen()
      return
    }
    if (!ready) event.preventDefault()
  }

  const content = <><LocationVisualPreview title={title} image={image} latitude={latitude} longitude={longitude} loading={loading} />{children}</>
  if (!ready && !onOpen) return <div className={className} style={{ position: 'relative', overflow: 'hidden' }}>{content}</div>

  return <a
    className={className}
    href={href}
    data-saved-morph-link={ready ? '' : undefined}
    data-saved-morph-photo={ready ? '' : undefined}
    aria-disabled={!ready}
    onClick={handleOpen}
    aria-label={`Open ${title}`}
    style={{ position: 'relative', overflow: 'hidden' }}
  >
    {content}
  </a>
}

export function SavedLightweightGrid({ items = [], className = '', cardClassName = '', photoClassName = '', copyClassName = '', metaClassName = '', perfectPickClassName = '', initialPreviews = null, loadPreviews = true, imageLoading = 'lazy', onOpen = null, classPrefix = 'saved-lightweight' }) {
  const ids = useMemo(() => items.map((item) => String(item.location_id || '')).filter(Boolean), [items])
  const gridRef = useRef(null)
  const resolvedIdsRef = useRef(new Set())
  const [previews, setPreviews] = useState(() => !loadPreviews && initialPreviews && typeof initialPreviews === 'object' ? initialPreviews : {})
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!ids.length) return undefined
    let active = true
    let controller = null
    let scheduled = null
    let fetching = false
    const queued = new Set()
    const knownIds = new Set(ids)
    setLoadError('')
    if (!loadPreviews) {
      setPreviews(initialPreviews && typeof initialPreviews === 'object' ? initialPreviews : {})
      return undefined
    }
    async function fetchQueued() {
      if (fetching || !active) return
      fetching = true
      while (active && queued.size) {
        const batch = [...queued].slice(0, 50)
        for (const id of batch) queued.delete(id)
        controller = new AbortController()
        try {
          const response = await fetch(`/api/saved-location-options?ids=${encodeURIComponent(batch.join(','))}`, { cache: 'no-store', signal: controller.signal })
          if (!response.ok) throw new Error(`Saved locations returned ${response.status}`)
          const payload = await response.json()
          if (!Array.isArray(payload?.items)) throw new Error('Saved locations returned invalid data')
          if (!active) break
          const { previews: next, missingIds } = resolveSavedPreviewBatch(batch, payload.items)
          for (const id of batch) resolvedIdsRef.current.add(id)
          if (Object.keys(next).length) {
            setPreviews((current) => ({ ...current, ...next }))
          }
          if (missingIds.length) setLoadError('Some saved places could not be loaded.')
        } catch (cause) {
          if (active && cause?.name !== 'AbortError') {
            console.warn('Could not load saved place previews.', { message: cause?.message || 'unknown error' })
            setLoadError('Saved places could not be loaded.')
          }
          break
        } finally {
          controller = null
        }
      }
      fetching = false
    }

    function queueVisible(id) {
      if (!knownIds.has(id) || resolvedIdsRef.current.has(id)) return
      queued.add(id)
      if (scheduled === null) {
        scheduled = window.setTimeout(() => {
          scheduled = null
          void fetchQueued()
        }, 0)
      }
    }

    const cards = gridRef.current?.querySelectorAll('[data-saved-preview-id]') || []
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const id = entry.target.dataset.savedPreviewId
        observer.unobserve(entry.target)
        if (id) queueVisible(id)
      }
    }, { rootMargin: '25% 0px' }) : null
    for (const card of cards) {
      if (observer) observer.observe(card)
      else queueVisible(card.dataset.savedPreviewId)
    }
    return () => {
      active = false
      observer?.disconnect()
      if (scheduled !== null) window.clearTimeout(scheduled)
      controller?.abort()
    }
  }, [ids, initialPreviews, loadPreviews, retry])

  const errorClass = `${classPrefix}-error`
  const titleClass = `${classPrefix}-title`
  const titleSkeletonClass = `${classPrefix}-title-skeleton`
  const metaClass = `${classPrefix}-meta`
  const metaSkeletonClass = `${classPrefix}-meta-skeleton`

  return <section ref={gridRef} className={className} aria-label="Saved places" data-testid="saved-grid">
    {loadError ? <div className={errorClass} role="alert"><strong>{loadError}</strong><button type="button" onClick={() => {
      resolvedIdsRef.current.clear()
      setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => !value?.unavailable)))
      setRetry((value) => value + 1)
    }}>Try again</button></div> : null}
    {items.map((item, index) => {
      const preview = previews[String(item.location_id)] || (!loadPreviews && item.slug ? item : null)
      const title = preview?.title || 'Saved place'
      const meta = preview?.city || categoryLabel(preview?.category)
      const slug = preview?.slug || null
      const image = preview?.cover_url || null
      const detail = slug ? `/plans/${slug}` : '#'
      const ready = Boolean(slug)
      const open = () => onOpen?.(item, preview)
      const titleDelay = `${Math.min(index, 12) * 34}ms`
      return <article
        className={cardClassName}
        data-testid="saved-card"
        data-saved-preview-id={item.location_id}
        data-saved-morph-card={ready ? '' : undefined}
        data-saved-morph-key={ready ? item.location_id : undefined}
        data-saved-morph-slug={ready ? slug : undefined}
        data-saved-morph-title={ready ? title : undefined}
        data-saved-morph-meta-text={ready ? meta : undefined}
        data-saved-morph-image={ready && image ? image : undefined}
        key={`saved:${item.location_id}`}
      >
        <SavedCardVisual className={photoClassName} href={detail} ready={ready} title={title} image={image} latitude={preview?.latitude} longitude={preview?.longitude} loading={imageLoading} onOpen={onOpen ? open : null}>
          {item.perfect_pick ? <b className={perfectPickClassName}>★ Perfect Pick</b> : null}
        </SavedCardVisual>
        <div className={copyClassName}>
          <h2>{ready || onOpen
            ? <a href={detail} data-saved-morph-link={ready ? '' : undefined} onClick={(event) => { if (onOpen) { event.preventDefault(); open() } else if (!ready) event.preventDefault() }}>
                {preview ? <span className={titleClass} style={{ '--saved-title-delay': titleDelay }}>{title}</span> : <span className={titleSkeletonClass} aria-hidden="true" />}
              </a>
            : preview ? <span className={titleClass} style={{ '--saved-title-delay': titleDelay }}>{title}</span> : <span className={titleSkeletonClass} aria-hidden="true" />}
          </h2>
          <div className={metaClassName}>
            {preview
              ? <small className={metaClass} style={{ '--saved-title-delay': titleDelay }}>{meta}</small>
              : <small><span className={metaSkeletonClass} aria-hidden="true" /></small>}
          </div>
        </div>
      </article>
    })}
  </section>
}
