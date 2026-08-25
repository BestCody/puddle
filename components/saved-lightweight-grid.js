"use client"

import { useEffect, useMemo, useState } from 'react'

const PREVIEW_CACHE_KEY = 'puddle:saved-place-previews:v1'
const PREVIEW_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PREVIEW_CACHE_LIMIT = 300

function categoryLabel(value) {
  return String(value || 'Saved place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function readPreviewCache(ids) {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_CACHE_KEY) || '{}')
    const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    const now = Date.now()
    const previews = {}
    for (const id of ids) {
      const entry = entries[id]
      if (!entry?.preview || !entry.cachedAt || now - entry.cachedAt > PREVIEW_CACHE_TTL_MS) continue
      previews[id] = entry.preview
    }
    return previews
  } catch {
    return {}
  }
}

function writePreviewCache(previews) {
  if (typeof window === 'undefined' || !Object.keys(previews).length) return
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_CACHE_KEY) || '{}')
    const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    const now = Date.now()
    for (const [id, preview] of Object.entries(previews)) entries[id] = { preview, cachedAt: now }
    const limited = Object.fromEntries(
      Object.entries(entries)
        .sort(([, left], [, right]) => Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0))
        .slice(0, PREVIEW_CACHE_LIMIT)
    )
    window.localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify({ entries: limited }))
  } catch {}
}

export function SavedLightweightGrid({ items = [], className = '', cardClassName = '', photoClassName = '', copyClassName = '', metaClassName = '', perfectPickClassName = '' }) {
  const ids = useMemo(() => items.map((item) => String(item.location_id || '')).filter(Boolean), [items])
  const [previews, setPreviews] = useState({})

  useEffect(() => {
    if (!ids.length) return undefined
    const controller = new AbortController()
    const cached = readPreviewCache(ids)
    if (Object.keys(cached).length) setPreviews(cached)

    const missingIds = ids.filter((id) => !cached[id])
    if (!missingIds.length) return () => controller.abort()

    fetch(`/api/saved-location-options?ids=${encodeURIComponent(missingIds.join(','))}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const next = {}
        for (const item of payload?.items || []) next[String(item.id)] = item
        if (!Object.keys(next).length) return
        setPreviews((current) => ({ ...current, ...next }))
        writePreviewCache(next)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [ids])

  return <section className={className} aria-label="Saved places" data-testid="saved-grid">
    {items.map((item, index) => {
      const preview = previews[String(item.location_id)]
      const title = preview?.title || 'Saved place'
      const meta = preview?.city || categoryLabel(preview?.category)
      const slug = preview?.slug || null
      const detail = slug ? `/plans/${slug}` : '#'
      const ready = Boolean(slug)
      const titleDelay = `${Math.min(index, 12) * 34}ms`
      return <article
        className={cardClassName}
        data-testid="saved-card"
        data-saved-morph-card={ready ? '' : undefined}
        data-saved-morph-key={ready ? item.location_id : undefined}
        data-saved-morph-slug={ready ? slug : undefined}
        data-saved-morph-title={ready ? title : undefined}
        data-saved-morph-meta-text={ready ? meta : undefined}
        key={`saved:${item.location_id}`}
      >
        <a className={photoClassName} href={detail} data-saved-morph-link={ready ? '' : undefined} aria-disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault() }} aria-label={`Open ${title}`}>
          <span aria-hidden="true">Puddle</span>
          {item.perfect_pick ? <b className={perfectPickClassName}>★ Perfect Pick</b> : null}
        </a>
        <div className={copyClassName}>
          <h2>
            <a href={detail} data-saved-morph-link={ready ? '' : undefined} onClick={(event) => { if (!ready) event.preventDefault() }}>
              {preview
                ? <span className="saved-lightweight-title" style={{ '--saved-title-delay': titleDelay }}>{title}</span>
                : <span className="saved-lightweight-title-skeleton" aria-hidden="true" />}
            </a>
          </h2>
          <div className={metaClassName}>
            {preview
              ? <small className="saved-lightweight-meta" style={{ '--saved-title-delay': titleDelay }}>{meta}</small>
              : <small><span className="saved-lightweight-meta-skeleton" aria-hidden="true" /></small>}
          </div>
        </div>
      </article>
    })}
  </section>
}
